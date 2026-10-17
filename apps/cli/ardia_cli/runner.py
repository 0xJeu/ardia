import ast
import asyncio
import builtins
import inspect
import json
import linecache
import sys
import traceback

from ardia_cli import guard
from ardia_cli.endpoint import NOT_REACHABLE, Endpoint, EndpointError
from ardia_cli.redact import redact

PAGE_SCHEMES = ("http:", "https:", "file:", "about:", "data:", "blob:")
CONNECT_TIMEOUT = 10
PROBE_TIMEOUT = 1.5
CLOSE_TIMEOUT = 3
EXCEPTIONS = (
    "ElementNotFound",
    "WaitElementTimeout",
    "WaitTimeout",
    "PageLoadTimeout",
    "NavigationError",
    "ScriptEvaluationError",
)


class UserCodeError(Exception):
    def __init__(self, error: BaseException, filename: str):
        super().__init__(str(error))
        self.error = error
        self.filename = filename


class ExecTimeout(Exception):
    pass


def compile_code(source: str, filename: str):
    linecache.cache[filename] = (len(source), None, source.splitlines(True), filename)
    tree = ast.parse(source, filename, "exec")
    flags = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    body = compile(tree, filename, "exec", flags=flags)
    tail = compile(last, filename, "eval", flags=flags) if last is not None else None
    names = {node.id for node in ast.walk(ast.parse(source, filename, "exec")) if isinstance(node, ast.Name)}
    return body, tail, names


def _refuse_stop(*_args, **_kwargs):
    raise RuntimeError("ardia exec never stops Ardia: it's the user's browser")


async def _refuse_stop_async(*_args, **_kwargs):
    _refuse_stop()


def is_page(target: dict) -> bool:
    return target.get("type") == "page" and str(target.get("url", "")).startswith(PAGE_SCHEMES)


class Session:
    def __init__(self, endpoint: Endpoint):
        from pydoll.browser.chromium import Chrome

        guard.install()
        self.endpoint = endpoint
        self.browser = Chrome()
        self.browser.stop = _refuse_stop_async
        self._tabs: dict[str, object] = {}
        self.opened: list = []

    async def connect(self):
        from pydoll.exceptions import NoValidTabFound

        try:
            await asyncio.wait_for(self.browser.connect(self.endpoint.ws), CONNECT_TIMEOUT)
        except NoValidTabFound:
            pass
        except Exception as error:
            raise EndpointError(self._unreachable(error)) from None

    def _unreachable(self, error: BaseException) -> str:
        if self.endpoint.explicit:
            detail = str(error) or type(error).__name__
            return redact(f"can't connect to {self.endpoint.source} ({detail})")
        return NOT_REACHABLE

    def lost(self) -> str:
        if self.endpoint.explicit:
            return redact(f"lost the connection to {self.endpoint.source}")
        return NOT_REACHABLE

    def browser_socket(self):
        return self.browser._connection_handler._ws_connection

    def _tab_for(self, target: dict):
        from pydoll.browser.tab import Tab

        target_id = target["targetId"]
        tab = self._tabs.get(target_id) or self.browser._tabs_opened.get(target_id)
        if tab is None:
            tab = Tab(self.browser, **self.browser._get_tab_kwargs(target_id))
            self.browser._tabs_opened[target_id] = tab
        self._tabs[target_id] = tab
        return tab

    async def page_tabs(self) -> list:
        targets = await self.browser.get_targets()
        return [self._tab_for(target) for target in targets if is_page(target)]

    async def new_tab(self, url: str = "about:blank", background: bool = True):
        from pydoll.commands import TargetCommands

        response = await self.browser._execute_command(
            TargetCommands.create_target(url="about:blank", background=background)
        )
        tab = self._tab_for({"targetId": response["result"]["targetId"]})
        self.opened.append(tab)
        if url and url != "about:blank":
            await tab.go_to(url)
        return tab

    async def _probe(self, tab):
        try:
            response = await asyncio.wait_for(
                tab.execute_script(
                    "[document.visibilityState === 'visible', document.hasFocus()]",
                    return_by_value=True,
                ),
                PROBE_TIMEOUT,
            )
            visible, focused = response["result"]["result"]["value"]
            return tab, bool(visible), bool(focused)
        except Exception:
            return tab, False, False

    async def current_tab(self, tabs: list):
        if not tabs:
            return None
        visible = set()
        probes = [asyncio.ensure_future(self._probe(tab)) for tab in tabs]
        try:
            for done in asyncio.as_completed(probes):
                tab, is_visible, focused = await done
                if is_visible and focused:
                    return tab
                if is_visible:
                    visible.add(id(tab))
        finally:
            for probe in probes:
                probe.cancel()
        return next((tab for tab in tabs if id(tab) in visible), tabs[0])

    async def close(self):
        handlers = {id(tab._connection_handler): tab._connection_handler for tab in self._tabs.values()}
        for tab in list(self.browser._tabs_opened.values()):
            handlers[id(tab._connection_handler)] = tab._connection_handler
        closers = [handler.close() for handler in handlers.values()]
        closers.append(self.browser.close())
        try:
            await asyncio.wait_for(asyncio.gather(*closers, return_exceptions=True), CLOSE_TIMEOUT)
        except (asyncio.TimeoutError, Exception):
            pass


def build_namespace(session: Session, filename: str) -> dict:
    import pydoll
    from pydoll.constants import By, Key

    async def new_tab(url: str = "about:blank", background: bool = True):
        tab = await session.new_tab(url, background)
        namespace["tabs"].append(tab)
        return tab

    namespace = {
        "__name__": "__main__",
        "__file__": filename,
        "__builtins__": builtins,
        "asyncio": asyncio,
        "browser": session.browser,
        "new_tab": new_tab,
        "tabs": [],
        "By": By,
        "Key": Key,
    }
    for name in pydoll.__all__:
        namespace.setdefault(name, getattr(pydoll, name))
    from pydoll import exceptions

    for name in EXCEPTIONS:
        namespace[name] = getattr(exceptions, name)

    async def js(expression: str, tab=None):
        target = tab or namespace.get("tab") or (session.opened[-1] if session.opened else None)
        if target is None:
            raise RuntimeError("no tab to evaluate in: there's no web page open, pass one or open one with new_tab")
        response = await target.execute_script(expression, return_by_value=True, await_promise=True)
        result = response["result"]
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            message = details.get("exception", {}).get("description") or details.get("text")
            raise RuntimeError(f"JavaScript error: {message}")
        return result["result"].get("value")

    namespace["js"] = js
    return namespace


async def run_code(source: str, filename: str, endpoint: Endpoint, timeout: float | None):
    body, tail, names = compile_code(source, filename)
    session = Session(endpoint)
    try:
        await session.connect()
        namespace = build_namespace(session, filename)
        tabs = await session.page_tabs()
        namespace["tabs"].extend(tabs)
        namespace["tab"] = await session.current_tab(tabs) if "tab" in names or "js" in names else None
        socket = session.browser_socket()

        async def execute():
            try:
                result = eval(body, namespace)
                if inspect.iscoroutine(result):
                    await result
                if tail is None:
                    return None
                value = eval(tail, namespace)
                if inspect.iscoroutine(value):
                    value = await value
                return value
            except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
                raise
            except BaseException as error:
                raise UserCodeError(error, filename) from None

        running = asyncio.ensure_future(execute())
        closed = asyncio.ensure_future(socket.wait_closed()) if socket is not None else None
        try:
            waiting = {running} | ({closed} if closed else set())
            done, _ = await asyncio.wait(waiting, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            if running in done:
                return running.result()
            if closed is not None and closed in done:
                raise EndpointError(session.lost())
            raise ExecTimeout(f"timed out after {timeout:g}s")
        finally:
            for task in (running, closed):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(*(task for task in (running, closed) if task is not None), return_exceptions=True)
    finally:
        await session.close()


def format_value(value, as_json: bool) -> str | None:
    if as_json:
        return json.dumps(value, ensure_ascii=False, indent=2, default=_json_default)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return repr(value)


def _json_default(value):
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if isinstance(value, (set, frozenset, tuple)):
        return list(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return repr(value)


def format_user_error(error: UserCodeError) -> str:
    exc = error.error
    frames = [frame for frame in traceback.extract_tb(exc.__traceback__) if frame.filename == error.filename]
    lines = []
    if frames:
        lines.append("Traceback (most recent call last):\n")
        lines.extend(traceback.format_list(frames))
    lines.extend(traceback.format_exception_only(type(exc), exc))
    return redact("".join(lines))


def format_syntax_error(error: SyntaxError) -> str:
    return redact("".join(traceback.format_exception_only(type(error), error)))


def print_err(text: str) -> None:
    drain = getattr(sys.stdout, "drain", None)
    drain() if drain else sys.stdout.flush()
    sys.stderr.write(redact(text if text.endswith("\n") else text + "\n"))
