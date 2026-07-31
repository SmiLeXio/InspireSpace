import { useEffect, useState } from "react";

export function ClockPlugin() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = time.getSeconds();
  const minutes = time.getMinutes() + seconds / 60;
  const hours = (time.getHours() % 12) + minutes / 60;

  return (
    <div className="clock-plugin" aria-label={`当前时间 ${time.toLocaleTimeString("zh-CN")}`}>
      <div className="clock-face">
        <i className="clock-hand hour" style={{ transform: `rotate(${hours * 30}deg)` }} />
        <i className="clock-hand minute" style={{ transform: `rotate(${minutes * 6}deg)` }} />
        <i className="clock-hand second" style={{ transform: `rotate(${seconds * 6}deg)` }} />
        <b />
      </div>
      <div className="clock-digital">{time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</div>
      <div className="clock-date">{time.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</div>
    </div>
  );
}
