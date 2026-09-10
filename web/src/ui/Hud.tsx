import type { ConnStatus } from "../net/socket";

interface HudProps {
  status: ConnStatus;
  online: number;
  firstPerson: boolean;
  onToggleCam: () => void;
}

const STATUS_LABEL: Record<ConnStatus, string> = {
  connecting: "連線中…",
  open: "已連線",
  closed: "已斷線，重連中…",
};

export function Hud({ status, online, firstPerson, onToggleCam }: HudProps) {
  return (
    <div className="hud">
      <div className="hud__status">
        <span className={`hud__dot hud__dot--${status}`} />
        <span>{STATUS_LABEL[status]}</span>
        <span>· 線上 {online}</span>
      </div>

      <button className="hud__cam" onClick={onToggleCam}>
        {firstPerson ? "第三人稱 (V)" : "第一人稱 (V)"}
      </button>

      <div className="hud__hint">
        WASD / 方向鍵移動 · 點地板走過去 · 拖曳旋轉 · 滾輪縮放 · V 切換視角
      </div>
    </div>
  );
}
