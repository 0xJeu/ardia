import { ImportWindow } from "../import/ImportWindow";
import { SettingsWindow } from "./SettingsWindow";
import { SETTINGS_WINDOW_ID } from "./windows";

export function UtilityWindow({ id }: { id: string }) {
  return id === SETTINGS_WINDOW_ID ? <SettingsWindow /> : <ImportWindow />;
}
