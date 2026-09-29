import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, type Scene } from "@babylonjs/core";
import type { SessionState } from "../net/types";
import { ROOM_HALF_Z } from "./environment";
import { formatClock, remainingMs } from "./rotation";

// Four wall-mounted boards for the language-exchange session (docs/PLAN.md
// §一.A "TOPIC 1/2/3" + "TIMER 看板"), mounted along the north wall in reading
// order: TOPIC 1, TOPIC 2, TOPIC 3, TIMER.
//
// The topic boards are a *fixed* display of the host's first three topics —
// not the per-round rotation (that's SessionState.topic, already shown on the
// HUD's SessionPanel). The timer board is deliberately just a clock, nothing
// else (feedback after the first browser test: "計時器應該就是計時器"),
// showing 00:00 whenever no round is actively counting down.
const BOARD_Y = 2.15;
const BOARD_GAP_X = 7;
const BOARD_Z = -ROOM_HALF_Z + 0.18; // just proud of wallN's inner face

const TOPIC_WIDTH = 3.2;
const TOPIC_HEIGHT = 1.5;
const TOPIC_TEXTURE_W = 768;
const TOPIC_TEXTURE_H = 360; // matches the plane's 3.2:1.5 aspect

const TIMER_WIDTH = 2.4;
const TIMER_HEIGHT = 1.5;
const TIMER_TEXTURE_W = 640;
const TIMER_TEXTURE_H = 400; // matches the plane's 2.4:1.5 aspect

interface BoardLine {
  text: string;
  font: string;
  color: string;
  y: number;
}

function makeBoardPlane(
  scene: Scene,
  x: number,
  width: number,
  height: number,
  textureW: number,
  textureH: number,
): { plane: Mesh; texture: DynamicTexture } {
  const plane = MeshBuilder.CreatePlane("wallBoard", { width, height }, scene);
  plane.position.set(x, BOARD_Y, BOARD_Z);
  // CreatePlane's texture-correct face has normal -Z by default, which here
  // points into the wall — flip so the readable face points into the room.
  plane.rotation.y = Math.PI;
  plane.isPickable = false;

  const mat = new StandardMaterial("wallBoardMat", scene);
  mat.disableLighting = true; // unlit: readable regardless of scene lighting
  mat.backFaceCulling = false;
  mat.diffuseColor = Color3.Black();
  plane.material = mat;

  const texture = new DynamicTexture("wallBoardTex", { width: textureW, height: textureH }, scene, false);
  mat.emissiveTexture = texture;
  return { plane, texture };
}

function paintBoard(texture: DynamicTexture, w: number, h: number, lines: BoardLine[]): void {
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#241a12";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c8a96a";
  ctx.lineWidth = 8;
  ctx.strokeRect(5, 5, w - 10, h - 10);

  ctx.textAlign = "center";
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, w / 2, line.y);
  }
  texture.update();
}

/** Greedy word-wrap into at most `maxLines` lines of roughly `maxChars`
 * characters each — crude, but the prompts this deals with are short
 * (event.maxTopicRunes caps at 100 runes server-side) and this only needs to
 * read comfortably from across the room, not typeset perfectly. */
function wrapText(s: string, maxChars: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

class TopicBoard {
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private lastKey: string | undefined;

  constructor(
    scene: Scene,
    x: number,
    private readonly index: number,
  ) {
    const built = makeBoardPlane(scene, x, TOPIC_WIDTH, TOPIC_HEIGHT, TOPIC_TEXTURE_W, TOPIC_TEXTURE_H);
    this.plane = built.plane;
    this.texture = built.texture;
    this.paint(undefined);
  }

  /** `topic` is undefined until a session has started at least once, or if
   * the host configured fewer topics than there are boards. */
  update(topic: string | undefined): void {
    this.paint(topic);
  }

  private paint(topic: string | undefined): void {
    if (topic === this.lastKey) return;
    this.lastKey = topic;

    const body: BoardLine[] = topic
      ? wrapText(topic, 15, 3).map((text, i) => ({
          text,
          font: `bold 46px "Segoe UI", sans-serif`,
          color: "#ffd76a",
          y: 200 + i * 58,
        }))
      : [{ text: "（尚未設定）", font: `36px "Segoe UI", sans-serif`, color: "#9a8b76", y: 210 }];

    paintBoard(this.texture, TOPIC_TEXTURE_W, TOPIC_TEXTURE_H, [
      { text: `TOPIC ${this.index}`, font: `bold 52px "Segoe UI", sans-serif`, color: "#f5ead6", y: 100 },
      ...body,
    ]);
  }

  dispose(): void {
    this.texture.dispose();
    this.plane.dispose();
  }
}

class ClockBoard {
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private lastKey: string | undefined;

  constructor(scene: Scene, x: number) {
    const built = makeBoardPlane(scene, x, TIMER_WIDTH, TIMER_HEIGHT, TIMER_TEXTURE_W, TIMER_TEXTURE_H);
    this.plane = built.plane;
    this.texture = built.texture;
    this.paint("00:00");
  }

  /** Only ever shows the clock — no round count, no topic. 00:00 whenever no
   * round is actively counting down (idle, between rounds, or finished). */
  update(session: SessionState | null, clockOffsetMs: number, nowMs: number): void {
    this.paint(session?.active ? formatClock(remainingMs(session, clockOffsetMs, nowMs)) : "00:00");
  }

  private paint(clock: string): void {
    if (clock === this.lastKey) return;
    this.lastKey = clock;
    paintBoard(this.texture, TIMER_TEXTURE_W, TIMER_TEXTURE_H, [
      { text: clock, font: `bold 140px "Segoe UI", sans-serif`, color: "#ffd76a", y: 250 },
    ]);
  }

  dispose(): void {
    this.texture.dispose();
    this.plane.dispose();
  }
}

/** Owns all four wall boards and fans one session update out to each. */
export class SessionBoards {
  private readonly topics: TopicBoard[];
  private readonly clock: ClockBoard;

  constructor(scene: Scene) {
    const xs = [-1.5, -0.5, 0.5, 1.5].map((n) => n * BOARD_GAP_X);
    this.topics = [0, 1, 2].map((i) => new TopicBoard(scene, xs[i], i + 1));
    this.clock = new ClockBoard(scene, xs[3]);
  }

  update(session: SessionState | null, clockOffsetMs: number, nowMs: number): void {
    for (let i = 0; i < this.topics.length; i++) this.topics[i].update(session?.topics?.[i]);
    this.clock.update(session, clockOffsetMs, nowMs);
  }

  dispose(): void {
    for (const t of this.topics) t.dispose();
    this.clock.dispose();
  }
}
