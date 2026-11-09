import type { InputHTMLAttributes } from "react";
/** Native time inputs follow OS locale and can show AM/PM; this control is always HH:mm. */
export function TimeInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
) {
  return (
    <input
      {...props}
      type="text"
      inputMode="text"
      placeholder={props.placeholder ?? "ЧЧ:ММ"}
      pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
      maxLength={5}
      title="Время в 24-часовом формате, например 08:30 или 20:30"
    />
  );
}
