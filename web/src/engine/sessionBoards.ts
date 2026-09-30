import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, type Scene } from "@babylonjs/core";
import type { SessionState, TopicCard } from "../net/types";
import { ROOM_HALF_X } from "./environment";
import { formatClock, remainingMs } from "./rotation";

// Four wall-mounted boards for the language-exchange session (docs/PLAN.md
// §一.A "TOPIC 1/2/3" + "TIMER 看板"), mounted along the room's narrow (west)
// wall in reading order: TOPIC 1, TOPIC 2, TOPIC 3, TIMER.
//
// The topic boards are a *fixed* display of the host's first three topics —
// not the per-round rotation (that's SessionState.topic, already shown on the
// HUD's SessionPanel). Each is a clickable thumbnail (title only); clicking
// it opens a lightbox (ui/TopicLightbox.tsx) with the full article and
// discussion questions — Game.ts wires the click through onTopicBoardClick.
// The timer board is deliberately just a clock, nothing else (feedback after
// the first browser test: "計時器應該就是計時器"), showing 00:00 whenever no
// round is actively counting down.
const BOARD_Y = 2.15;
const BOARD_SPACING = 4.5; // metres between adjacent board centres, along Z
const BOARD_X = -ROOM_HALF_X + 0.18; // just proud of wallW's inner face
// CreatePlane's texture-correct face has normal -Z by default. Rotating -90°
// around Y turns that into +X, which points from wallW into the room.
const BOARD_ROTATION_Y = -Math.PI / 2;

const TOPIC_WIDTH = 2.6;
const TOPIC_HEIGHT = 1.5;
const TOPIC_TEXTURE_W = 624;
const TOPIC_TEXTURE_H = 360; // matches the plane's 2.6:1.5 aspect

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

/** Board centres along Z, evenly spaced and centred on the wall. */
function boardZ(index: number, count: number): number {
  return (index - (count - 1) / 2) * BOARD_SPACING;
}

function makeBoardPlane(
  scene: Scene,
  z: number,
  width: number,
  height: number,
  textureW: number,
  textureH: number,
): { plane: Mesh; texture: DynamicTexture } {
  const plane = MeshBuilder.CreatePlane("wallBoard", { width, height }, scene);
  plane.position.set(BOARD_X, BOARD_Y, z);
  plane.rotation.y = BOARD_ROTATION_Y;
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
 * characters each — crude, but this only needs to read comfortably as a
 * thumbnail title, not typeset perfectly (the full text lives in the
 * lightbox instead). */
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

/** A clickable thumbnail: title only (wrapped) plus a hint to click for more.
 * The full article/questions render in the 2D lightbox once clicked —
 * Game.ts's pointer picking resolves a hit on `meshName` back to this board's
 * index and looks up the matching SessionState.topics[index] itself. */
class TopicBoard {
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private lastKey: string | undefined;

  constructor(
    scene: Scene,
    z: number,
    private readonly index: number,
  ) {
    const built = makeBoardPlane(scene, z, TOPIC_WIDTH, TOPIC_HEIGHT, TOPIC_TEXTURE_W, TOPIC_TEXTURE_H);
    this.plane = built.plane;
    this.plane.name = `topicBoard${index - 1}`;
    this.plane.isPickable = true;
    this.texture = built.texture;
    this.paint(undefined);
  }

  get meshName(): string {
    return this.plane.name;
  }

  /** `topic` is undefined until a session has started at least once, or if
   * the host configured fewer topics than there are boards. */
  update(topic: TopicCard | undefined): void {
    this.paint(topic);
  }

  private paint(topic: TopicCard | undefined): void {
    const key = topic?.title;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const body: BoardLine[] = topic
      ? [
          ...wrapText(topic.title, 13, 3).map((text, i) => ({
            text,
            font: `bold 40px "Segoe UI", sans-serif`,
            color: "#ffd76a",
            y: 190 + i * 52,
          })),
          { text: "🔍 點擊查看", font: `28px "Segoe UI", sans-serif`, color: "#c8b89a", y: 330 },
        ]
      : [{ text: "（尚未設定）", font: `32px "Segoe UI", sans-serif`, color: "#9a8b76", y: 210 }];

    paintBoard(this.texture, TOPIC_TEXTURE_W, TOPIC_TEXTURE_H, [
      { text: `TOPIC ${this.index}`, font: `bold 48px "Segoe UI", sans-serif`, color: "#f5ead6", y: 90 },
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

  constructor(scene: Scene, z: number) {
    const built = makeBoardPlane(scene, z, TIMER_WIDTH, TIMER_HEIGHT, TIMER_TEXTURE_W, TIMER_TEXTURE_H);
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
    this.topics = [0, 1, 2].map((i) => new TopicBoard(scene, boardZ(i, 4), i + 1));
    this.clock = new ClockBoard(scene, boardZ(3, 4));
  }

  update(session: SessionState | null, clockOffsetMs: number, nowMs: number): void {
    for (let i = 0; i < this.topics.length; i++) this.topics[i].update(session?.topics?.[i]);
    this.clock.update(session, clockOffsetMs, nowMs);
  }

  /** Maps a picked mesh's name back to which topic board it is, or null if
   * the mesh isn't one of the topic boards (e.g. the clock board, which
   * isn't clickable, or anything else in the scene). */
  topicIndexForMesh(meshName: string): number | null {
    const i = this.topics.findIndex((b) => b.meshName === meshName);
    return i === -1 ? null : i;
  }

  dispose(): void {
    for (const t of this.topics) t.dispose();
    this.clock.dispose();
  }
}
