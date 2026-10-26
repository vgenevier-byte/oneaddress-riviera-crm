"use client";

import { useI18n } from "@/lib/i18n/I18nProvider";
import { isQuarterHourTime, QUARTER_HOUR_TIME_OPTIONS } from "@/lib/houseTracking";
import styles from "./HouseTimeSelect.module.css";

const hours = [...new Set(QUARTER_HOUR_TIME_OPTIONS.map(time => time.slice(0, 2)))];
const minutes = [...new Set(QUARTER_HOUR_TIME_OPTIONS.map(time => time.slice(3, 5)))];

/** Creation only: keep the draft as HH:mm; never normalize historical entries. */
export default function HouseTimeSelect({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [hour, minute] = value.split(":");
  function change(next: string) {
    if (isQuarterHourTime(next)) onChange(next);
  }

  return <fieldset className={styles.time}>
    <legend>{label}</legend>
    <div className={styles.parts}>
      <label>{t("crm.house.time.hour")}
        <select required value={hour} onChange={event => change(`${event.target.value}:${minute}`)}>
          {hours.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
      <label>{t("crm.house.time.minutes")}
        <select required value={minute} onChange={event => change(`${hour}:${event.target.value}`)}>
          {minutes.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    </div>
  </fieldset>;
}
