import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, type Scene } from "@babylonjs/core";
import type { SessionState } from "../net/types";
import { ROOM_HALF_Z } from "./environment";
import { formatClock, remainingMs } from "./rotation";

// A wall-mounted 3D scoreboard for the language-exchange session (docs/PLAN.md
// §一.A "TIMER 看板顯示輪次") — the HUD's SessionPanel already shows this same
// data as a DOM overlay; this paints it onto a DynamicTexture plane mounted
// flush against the north wall so it reads as part of the room, not just a UI
// widget. Same recipe as remotePlayers.ts's status badges: unlit plane,
// emissive-only DynamicTexture.
const BOARD_WIDTH = 4;
const BOARD_HEIGHT = 1.5;
const BOARD_Y = 2.15;
const TEXTURE_W = 1024;
const TEXTURE_H = 384;

export class TimerBoard {
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private lastKey = "";

  constructor(scene: Scene) {
    this.plane = MeshBuilder.CreatePlane("timerBoard", { width: BOARD_WIDTH, height: BOARD_HEIGHT }, scene);
    // Just proud of wallN's inner face (wall is centred on -ROOM_HALF_Z, ~0.3m
    // thick) — close enough to read as "mounted on the wall" without needing
    // environment.ts to export its wall thickness constant.
    this.plane.position.set(0, BOARD_Y, -ROOM_HALF_Z + 0.18);
    this.plane.isPickable = false;

    const mat = new StandardMaterial("timerBoardMat", scene);
    mat.disableLighting = true; // unlit: readable regardless of scene lighting
    mat.backFaceCulling = false;
    mat.diffuseColor = Color3.Black();
    this.plane.material = mat;

    this.texture = new DynamicTexture("timerBoardTex", { width: TEXTURE_W, height: TEXTURE_H }, scene, false);
    mat.emissiveTexture = this.texture;

    this.paint("英語口說練習咖啡廳", "", "");
  }

  /** Safe to call every frame — it only actually redraws the canvas when the
   * displayed text changes, so an idle or paused session costs nothing. */
  update(session: SessionState | null, clockOffsetMs: number, nowMs: number): void {
    if (!session || !session.active) {
      this.paint("英語口說練習咖啡廳", session?.finished ? "活動已結束，謝謝參加！" : "", "");
      return;
    }
    const clock = formatClock(remainingMs(session, clockOffsetMs, nowMs));
    this.paint(`第 ${session.round} / ${session.rounds} 輪`, clock, session.topic);
  }

  private paint(line1: string, line2: string, line3: string): void {
    const key = `${line1}|${line2}|${line3}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const ctx = this.texture.getContext() as CanvasRenderingContext2D;
    ctx.fillStyle = "#241a12";
    ctx.fillRect(0, 0, TEXTURE_W, TEXTURE_H);
    ctx.strokeStyle = "#c8a96a";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, TEXTURE_W - 10, TEXTURE_H - 10);

    ctx.textAlign = "center";
    ctx.fillStyle = "#f5ead6";
    ctx.font = `bold 60px "Segoe UI", sans-serif`;
    ctx.fillText(line1, TEXTURE_W / 2, 110);

    if (line2) {
      ctx.font = `bold 100px "Segoe UI", sans-serif`;
      ctx.fillStyle = "#ffd76a";
      ctx.fillText(line2, TEXTURE_W / 2, 250);
    }

    if (line3) {
      ctx.font = `40px "Segoe UI", sans-serif`;
      ctx.fillStyle = "#f5ead6";
      ctx.fillText(truncate(line3, 28), TEXTURE_W / 2, 330);
    }

    this.texture.update();
  }

  dispose(): void {
    this.texture.dispose();
    this.plane.dispose();
  }
}

function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : s;
}
