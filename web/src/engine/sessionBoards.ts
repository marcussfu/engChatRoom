import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, type Scene } from "@babylonjs/core";
import type { SessionState, TopicCard } from "../net/types";
import { ROOM_HALF_X, ROOM_HALF_Z } from "./environment";
import { formatClock, remainingMs } from "./rotation";

// Wall-mounted boards for the language-exchange session (docs/PLAN.md §一.A
// "TOPIC 1/2/3" + "TIMER 看板"). Four are mounted along the room's narrow
// (west) wall in reading order: TOPIC 1, TOPIC 2, TOPIC 3, TIMER. A fifth,
// bigger board mounts on wallS (2026-10-01 feedback, item 3): the host can
// "feature" one of TOPIC 1-3 there, so the room has one obvious "what we're
// discussing" focal point instead of everyone having to walk over and read a
// thumbnail.
//
// The topic boards are a *fixed* display of the host's first three topics —
// not the per-round rotation (that's SessionState.topic, already shown on the
// HUD's SessionPanel). Each (including the featured board) is clickable;
// clicking opens a lightbox (ui/TopicLightbox.tsx) with the full article,
// discussion questions, and embedded link if any — Game.ts wires the click
// through onTopicBoardClick. The timer board is deliberately just a clock,
// nothing else (feedback after the first browser test: "計時器應該就是計時
// 器"), showing 00:00 whenever no round is actively counting down.
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

// The featured board sits on wallS, off to one side of spawn, above the
// broadcast zone (environment.ts's BROADCAST_ZONE) — both are part of the
// same "stage" corner (2026-10-01 feedback, items 3 and 6).
const FEATURED_X = 9;
const FEATURED_WIDTH = 3.4;
const FEATURED_HEIGHT = 2.1;
const FEATURED_TEXTURE_W = 816;
const FEATURED_TEXTURE_H = 504; // matches the plane's 3.4:2.1 aspect

interface BoardLine {
  text: string;
  font: string;
  color: string;
  y: number;
}

interface WallMount {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

/** Board centres along Z, evenly spaced and centred on wallW. */
function boardZ(index: number, count: number): number {
  return (index - (count - 1) / 2) * BOARD_SPACING;
}

function makeBoardPlane(
  scene: Scene,
  mount: WallMount,
  width: number,
  height: number,
  textureW: number,
  textureH: number,
): { plane: Mesh; texture: DynamicTexture } {
  const plane = MeshBuilder.CreatePlane("wallBoard", { width, height }, scene);
  plane.position.set(mount.x, mount.y, mount.z);
  plane.rotation.y = mount.rotationY;
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
    mount: WallMount,
    private readonly index: number,
  ) {
    const built = makeBoardPlane(scene, mount, TOPIC_WIDTH, TOPIC_HEIGHT, TOPIC_TEXTURE_W, TOPIC_TEXTURE_H);
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

  constructor(scene: Scene, mount: WallMount) {
    const built = makeBoardPlane(scene, mount, TIMER_WIDTH, TIMER_HEIGHT, TIMER_TEXTURE_W, TIMER_TEXTURE_H);
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

/** The host-featured big board on wallS (item 3): shows one TOPIC's full
 * content (not just a thumbnail) so the room has one obvious shared focal
 * point, without everyone needing to walk over to a TOPIC 1/2/3 thumbnail.
 * Clickable too, opening the same lightbox. */
class FeaturedBoard {
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private lastKey: string | undefined;

  constructor(scene: Scene) {
    const mount: WallMount = { x: FEATURED_X, y: BOARD_Y, z: ROOM_HALF_Z - 0.18, rotationY: 0 };
    const built = makeBoardPlane(scene, mount, FEATURED_WIDTH, FEATURED_HEIGHT, FEATURED_TEXTURE_W, FEATURED_TEXTURE_H);
    this.plane = built.plane;
    this.plane.name = "featuredBoard";
    this.plane.isPickable = true;
    this.texture = built.texture;
    this.paint(undefined);
  }

  get meshName(): string {
    return this.plane.name;
  }

  /** `card` is undefined until the host features a topic (see
   * Game.hostFeature / SessionState.featuredTopic). */
  update(card: TopicCard | undefined): void {
    this.paint(card);
  }

  private paint(card: TopicCard | undefined): void {
    const key = card?.title;
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (!card) {
      paintBoard(this.texture, FEATURED_TEXTURE_W, FEATURED_TEXTURE_H, [
        { text: "目前討論主題", font: `bold 36px "Segoe UI", sans-serif`, color: "#c8b89a", y: 70 },
        { text: "（主持人尚未選擇）", font: `30px "Segoe UI", sans-serif`, color: "#9a8b76", y: 260 },
      ]);
      return;
    }

    const lines: BoardLine[] = [
      { text: "目前討論主題", font: `bold 30px "Segoe UI", sans-serif`, color: "#c8b89a", y: 46 },
    ];
    wrapText(card.title, 24, 2).forEach((t, i) =>
      lines.push({ text: t, font: `bold 40px "Segoe UI", sans-serif`, color: "#ffd76a", y: 102 + i * 46 }),
    );
    if (card.article) {
      wrapText(card.article, 40, 3).forEach((t, i) =>
        lines.push({ text: t, font: `23px "Segoe UI", sans-serif`, color: "#f5ead6", y: 220 + i * 32 }),
      );
    }
    card.questions?.slice(0, 2).forEach((q, i) => {
      const [t] = wrapText(q, 38, 1);
      if (t) lines.push({ text: `• ${t}`, font: `21px "Segoe UI", sans-serif`, color: "#d8cdb8", y: 340 + i * 32 });
    });
    lines.push({
      text: card.embedUrl ? "🔗 點擊查看完整內容與連結" : "🔍 點擊查看完整內容",
      font: `22px "Segoe UI", sans-serif`,
      color: "#9fd3ff",
      y: FEATURED_TEXTURE_H - 30,
    });

    paintBoard(this.texture, FEATURED_TEXTURE_W, FEATURED_TEXTURE_H, lines);
  }

  dispose(): void {
    this.texture.dispose();
    this.plane.dispose();
  }
}

/** Owns all five wall boards (3 topic thumbnails + clock on wallW, the
 * featured board on wallS) and fans one session update out to each. */
export class SessionBoards {
  private readonly topics: TopicBoard[];
  private readonly clock: ClockBoard;
  private readonly featured: FeaturedBoard;

  constructor(scene: Scene) {
    const wallWMount = (i: number): WallMount => ({ x: BOARD_X, y: BOARD_Y, z: boardZ(i, 4), rotationY: BOARD_ROTATION_Y });
    this.topics = [0, 1, 2].map((i) => new TopicBoard(scene, wallWMount(i), i + 1));
    this.clock = new ClockBoard(scene, wallWMount(3));
    this.featured = new FeaturedBoard(scene);
  }

  update(session: SessionState | null, clockOffsetMs: number, nowMs: number): void {
    for (let i = 0; i < this.topics.length; i++) this.topics[i].update(session?.topics?.[i]);
    this.clock.update(session, clockOffsetMs, nowMs);
    const featuredIndex = session?.featuredTopic ?? 0;
    this.featured.update(featuredIndex > 0 ? session?.topics?.[featuredIndex - 1] : undefined);
  }

  /** Maps a picked mesh's name back to which topic board it is, or null if
   * the mesh isn't one of the topic boards (e.g. the clock board, which
   * isn't clickable, or anything else in the scene). */
  topicIndexForMesh(meshName: string): number | null {
    const i = this.topics.findIndex((b) => b.meshName === meshName);
    return i === -1 ? null : i;
  }

  /** True if `meshName` is the big featured board on wallS. */
  isFeaturedBoardMesh(meshName: string): boolean {
    return this.featured.meshName === meshName;
  }

  dispose(): void {
    for (const t of this.topics) t.dispose();
    this.clock.dispose();
    this.featured.dispose();
  }
}
