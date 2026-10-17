import io
import logging
import re

MASK = "***"
_TOKEN_QUERY = re.compile(r"(token=)[^&\s'\"<>]+")
_secrets: set[str] = set()
_installed = False


def add_secret(secret: str | None) -> None:
    if secret:
        _secrets.add(secret)
        from urllib.parse import quote

        _secrets.add(quote(secret, safe=""))


def redact(text: str) -> str:
    for secret in sorted(_secrets, key=len, reverse=True):
        text = text.replace(secret, MASK)
    return _TOKEN_QUERY.sub(r"\1" + MASK, text)


class RedactingStream(io.TextIOBase):
    def __init__(self, stream):
        self._stream = stream

    def write(self, text):
        self._stream.write(redact(text))
        return len(text)

    def flush(self):
        self._stream.flush()

    def isatty(self):
        return self._stream.isatty()

    def fileno(self):
        return self._stream.fileno()

    @property
    def encoding(self):
        return self._stream.encoding

    @property
    def buffer(self):
        return self._stream.buffer


def install_log_redaction() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    make_record = logging.getLogRecordFactory()

    def redacting_record(*args, **kwargs):
        record = make_record(*args, **kwargs)
        try:
            message = record.getMessage()
        except Exception:
            return record
        cleaned = redact(message)
        if cleaned != message:
            record.msg = cleaned
            record.args = ()
        return record

    logging.setLogRecordFactory(redacting_record)
    logging.getLogger("pydoll").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
