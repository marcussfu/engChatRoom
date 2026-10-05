import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Vector3, type Scene } from "@babylonjs/core";
import type { SessionState, TopicCard } from "../net/types";
import { ROOM_HALF_X, ROOM_HALF_Z } from "./environment";
import { formatClock, remainingMs } from "./rotation";

// Wall-mounted boards for the language-exchange session (docs/PLAN.md §一.A
// "TOPIC 1/2/3" + "TIMER 看板"). Four are mounted along the room's narrow
// (west) wall in reading order: TOPIC 1, TOPIC 2, TOPIC 3, TIMER. A fifth,
// bigger screen mounts on wallN (2026-10-01 feedback, item 3; moved there
// 2026-10-05): the host can "feature" one of TOPIC 1-3 on it, so the room has
// one obvious "what we're discussing" focal point instead of everyone having
// to walk over and read a thumbnail.
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

// The featured "big screen" sits centred on wallN (2026-10-05: moved from
// wallS and enlarged to a 16:9 screen, since spawn now sits by wallE). Its
// texture shows the featured TOPIC's title/article/questions; when that TOPIC
// has an embed link, Game.ts lays a DOM iframe over the plane (WebGL textures
// can't host a live iframe, so the overlay is positioned by projecting the
// plane's corners to screen space each frame).
export const FEATURED_X = 0;
export const FEATURED_Y = 3;
export const FEATURED_WIDTH = 7.2;
export const FEATURED_HEIGHT = 4.05; // 16:9
const FEATURED_TEXTURE_W = 1280;
const FEATURED_TEXTURE_H = 720; // matches the plane's 16:9 aspect

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

/** The host-featured big screen on wallN: shows one TOPIC's content so the
 * room has one obvious shared focal point. Clickable too, opening the same
 * lightbox (the lightbox is where the iframe lives when there's no overlay). */
class FeaturedBoard {
  private readonly plane: Mesh;
  private readonly texture: DynamicTexture;
  private lastKey: string | undefined;

  constructor(scene: Scene) {
    // rotationY = PI: the readable face points +Z, into the room (same as wallN's other mounts).
    const mount: WallMount = { x: FEATURED_X, y: FEATURED_Y, z: -ROOM_HALF_Z + 0.18, rotationY: Math.PI };
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

  /** The screen's four corners in world space (it's axis-aligned on wallN). */
  worldCorners(): Vector3[] {
    const hw = FEATURED_WIDTH / 2;
    const hh = FEATURED_HEIGHT / 2;
    const z = -ROOM_HALF_Z + 0.18;
    return [
      new Vector3(FEATURED_X - hw, FEATURED_Y - hh, z),
      new Vector3(FEATURED_X + hw, FEATURED_Y - hh, z),
      new Vector3(FEATURED_X + hw, FEATURED_Y + hh, z),
      new Vector3(FEATURED_X - hw, FEATURED_Y + hh, z),
    ];
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
        { text: "目前討論主題", font: `bold 56px "Segoe UI", sans-serif`, color: "#c8b89a", y: 150 },
        { text: "（主持人尚未選擇）", font: `46px "Segoe UI", sans-serif`, color: "#9a8b76", y: 380 },
      ]);
      return;
    }

    const lines: BoardLine[] = [
      { text: "目前討論主題", font: `bold 46px "Segoe UI", sans-serif`, color: "#c8b89a", y: 72 },
    ];
    wrapText(card.title, 36, 2).forEach((t, i) =>
      lines.push({ text: t, font: `bold 62px "Segoe UI", sans-serif`, color: "#ffd76a", y: 160 + i * 70 }),
    );
    if (card.article) {
      wrapText(card.article, 60, 3).forEach((t, i) =>
        lines.push({ text: t, font: `36px "Segoe UI", sans-serif`, color: "#f5ead6", y: 340 + i * 50 }),
      );
    }
    card.questions?.slice(0, 2).forEach((q, i) => {
      const [t] = wrapText(q, 58, 1);
      if (t) lines.push({ text: `• ${t}`, font: `32px "Segoe UI", sans-serif`, color: "#d8cdb8", y: 530 + i * 46 });
    });
    lines.push({
      text: card.embedUrl ? "🔗 點擊查看完整內容與連結" : "🔍 點擊查看完整內容",
      font: `34px "Segoe UI", sans-serif`,
      color: "#9fd3ff",
      y: FEATURED_TEXTURE_H - 40,
    });

    paintBoard(this.texture, FEATURED_TEXTURE_W, FEATURED_TEXTURE_H, lines);
  }

  dispose(): void {
    this.texture.dispose();
    this.plane.dispose();
  }
}

/** Owns all five wall boards (3 topic thumbnails + clock on wallW, the
 * featured big screen on wallN) and fans one session update out to each. */
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

  /** True if `meshName` is the big featured screen on wallN. */
  isFeaturedBoardMesh(meshName: string): boolean {
    return this.featured.meshName === meshName;
  }

  /** World-space corners of the featured screen, for laying the iframe overlay over it. */
  featuredScreenCorners(): Vector3[] {
    return this.featured.worldCorners();
  }

  dispose(): void {
    for (const t of this.topics) t.dispose();
    this.clock.dispose();
    this.featured.dispose();
  }
}
