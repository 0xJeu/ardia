import { forwardRef, useCallback, type ComponentProps, type ForwardedRef, type KeyboardEvent } from "react";
import { unstable_batchedUpdates as batchedUpdates } from "react-dom";
import { Animated as WebAnimated, TextInput as WebTextInput } from "react-native-web";

export * from "react-native-web";

export const unstable_batchedUpdates = batchedUpdates;

class JsDrivenValue extends WebAnimated.Value {
  constructor(value: number, config?: { useNativeDriver?: boolean }) {
    super(value, config ? { ...config, useNativeDriver: false } : undefined);
  }
}

type Driven = { useNativeDriver?: boolean };
const jsDriven = <C extends Driven | undefined>(config: C): C => (config ? { ...config, useNativeDriver: false } : config);

export const Animated = {
  ...WebAnimated,
  Value: JsDrivenValue,
  timing: (value: never, config: Driven) => WebAnimated.timing(value, jsDriven(config) as never),
  spring: (value: never, config: Driven) => WebAnimated.spring(value, jsDriven(config) as never),
  decay: (value: never, config: Driven) => WebAnimated.decay(value, jsDriven(config) as never),
  event: (mapping: never, config?: Driven) => WebAnimated.event(mapping, jsDriven(config) as never),
} as unknown as typeof WebAnimated;

export const findNodeHandle = (component: unknown) => (component instanceof Element ? component : null) as unknown as number | null;

type KeyMatch = { key: string; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean };
type MacTextInputProps = ComponentProps<typeof WebTextInput> & {
  keyDownEvents?: KeyMatch[];
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
};

const MODIFIERS = ["metaKey", "shiftKey", "altKey", "ctrlKey"] as const;
const matches = (e: KeyboardEvent, wanted: KeyMatch) =>
  e.key === wanted.key && MODIFIERS.every((m) => wanted[m] === undefined || !!e[m] === wanted[m]);

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export const TextInput = forwardRef<unknown, MacTextInputProps>(function MacTextInput({ keyDownEvents, onKeyDown, ...props }, ref) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!keyDownEvents) return onKeyDown?.(e);
    if (!keyDownEvents.some((wanted) => matches(e, wanted))) return;
    e.preventDefault();
    onKeyDown?.(e);
  };
  const attach = useCallback((node: HTMLInputElement | null) => {
    if (node) Object.assign(node, { setSelection: (start: number, end: number) => node.setSelectionRange(start, end) });
    assignRef(ref, node);
  }, [ref]);
  const Input = WebTextInput as unknown as React.ComponentType<Record<string, unknown>>;
  return <Input {...props} ref={attach} onKeyPress={onKeyDown || keyDownEvents ? handleKeyDown : props.onKeyPress} />;
});
