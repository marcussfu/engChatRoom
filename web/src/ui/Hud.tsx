import type { MediaStatus } from "../media/livekit";
import type { ConnStatus } from "../net/socket";

interface HudProps {
  status: ConnStatus;
  online: number;
  firstPerson: boolean;
  zoneLabel: string | null;
  mediaStatus: MediaStatus;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  headphonesMode: boolean;
  onToggleCam: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleHeadphones: () => void;
}

const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting: "連線中…",
  open: "已連線",
  closed: "已斷線，重連中…",
};

const MEDIA_LABEL: Record<MediaStatus, string> = {
  idle: "語音未啟動",
  connecting: "語音連線中…",
  connected: "語音已連線",
  disconnected: "語音已斷線",
  unavailable: "語音未設定",
  error: "語音連線失敗",
};

export function Hud({
  status,
  online,
  firstPerson,
  zoneLabel,
  mediaStatus,
  micEnabled,
  cameraEnabled,
  screenShareEnabled,
  headphonesMode,
  onToggleCam,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onToggleHeadphones,
}: HudProps) {
  const mediaConnected = mediaStatus === "connected";

  return (
    <div className="hud">
      <div className="hud__status">
        <span className={`hud__dot hud__dot--${status}`} />
        <span>{STATUS_LABEL[status]}</span>
        <span>· 線上 {online}</span>
        <span className="hud__sep" />
        <span className={`hud__dot hud__dot--media-${mediaStatus}`} />
        <span>{MEDIA_LABEL[mediaStatus]}</span>
      </div>

      {zoneLabel && <div className="hud__zone">🗨️ {zoneLabel}</div>}

      <div className="hud__topRight">
        <button className="hud__btn" onClick={onToggleMic} disabled={!mediaConnected}>
          {micEnabled ? "🎤 麥克風開" : "🔇 麥克風關"}
        </button>
        <button className="hud__btn" onClick={onToggleCamera} disabled={!mediaConnected}>
          {cameraEnabled ? "📷 鏡頭開" : "📷 鏡頭關"}
        </button>
        <button className="hud__btn" onClick={onToggleScreenShare} disabled={!mediaConnected}>
          {screenShareEnabled ? "🖥️ 分享中" : "🖥️ 分享螢幕"}
        </button>
        <button className="hud__btn" onClick={onToggleHeadphones}>
          {headphonesMode ? "🎧 耳機模式開" : "🎧 耳機模式關"}
        </button>
        <button className="hud__cam" onClick={onToggleCam}>
          {firstPerson ? "第三人稱 (V)" : "第一人稱 (V)"}
        </button>
      </div>

      <div className="hud__hint">
        WASD / 方向鍵移動 · 點地板走過去 · 點椅子坐下（再點一次站起）· 拖曳旋轉 · 滾輪縮放 · V 切換視角
      </div>
    </div>
  );
}
