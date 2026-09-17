import { useEffect, useState } from "react";
import type { Game } from "../engine/Game";

interface DeviceMenuProps {
  game: Game | null;
  /** Only show once LiveKit is actually connected — device labels need
   * getUserMedia permission to have been granted at least once anyway. */
  enabled: boolean;
}

/** A small gear button that opens a panel to pick the mic/camera device.
 * Device labels are blank until permission has been granted once (browser
 * privacy rule) — by the time this is enabled, mic/camera have usually
 * already been used at least once. */
export function DeviceMenu({ game, enabled }: DeviceMenuProps) {
  const [open, setOpen] = useState(false);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!open || !game) return;
    game.listAudioInputs().then(setAudioInputs);
    game.listVideoInputs().then(setVideoInputs);
  }, [open, game]);

  if (!enabled) return null;

  return (
    <div className="deviceMenu">
      <button className="hud__btn" onClick={() => setOpen((o) => !o)}>
        ⚙️ 裝置
      </button>
      {open && (
        <div className="deviceMenu__panel">
          <label className="deviceMenu__row">
            <span>麥克風</span>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && game?.setAudioInputDevice(e.target.value)}
            >
              <option value="" disabled>
                選擇裝置…
              </option>
              {audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "麥克風"}
                </option>
              ))}
            </select>
          </label>
          <label className="deviceMenu__row">
            <span>鏡頭</span>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && game?.setVideoInputDevice(e.target.value)}
            >
              <option value="" disabled>
                選擇裝置…
              </option>
              {videoInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "鏡頭"}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
