/**
 * AssetLoader — Agentshire 资产加载器（清单制 + 骨骼安全克隆）。
 *
 * 适配移植自 Agentshire（MIT，https://github.com/xiaojilele-glitch/agentshire
 * commit f54a798）town-frontend/src/game/visual/AssetLoader.ts。
 * 改动：清单裁剪为办公室场景所需子集（12 个人类角色 + 家具件），资产
 * 路径指向本仓库 client/public/agentshire-assets（CC0，署名见该目录
 * THIRD_PARTY_NOTICES.md）；删除本项目用不到的 library/custom 角色
 * 动态加载通道。核心手法保留：GLTF 缓存 + SkinnedMesh 用
 * SkeletonUtils.clone（普通 clone 会丢骨骼绑定）。
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

export interface AssetManifest {
  characters: Record<string, string>;
  furniture: Record<string, string>;
}

const BASE = import.meta.env.BASE_URL + "agentshire-assets/models";

const MANIFEST: AssetManifest = {
  characters: {
    "char-male-a": `${BASE}/characters/character-male-a.glb`,
    "char-male-b": `${BASE}/characters/character-male-b.glb`,
    "char-male-c": `${BASE}/characters/character-male-c.glb`,
    "char-male-d": `${BASE}/characters/character-male-d.glb`,
    "char-male-e": `${BASE}/characters/character-male-e.glb`,
    "char-male-f": `${BASE}/characters/character-male-f.glb`,
    "char-female-a": `${BASE}/characters/character-female-a.glb`,
    "char-female-b": `${BASE}/characters/character-female-b.glb`,
    "char-female-c": `${BASE}/characters/character-female-c.glb`,
    "char-female-d": `${BASE}/characters/character-female-d.glb`,
    "char-female-e": `${BASE}/characters/character-female-e.glb`,
    "char-female-f": `${BASE}/characters/character-female-f.glb`,
  },
  furniture: {
    table_medium: `${BASE}/furniture/table_medium.gltf`,
    table_low: `${BASE}/furniture/table_low.gltf`,
    chair_A: `${BASE}/furniture/chair_A.gltf`,
    armchair: `${BASE}/furniture/armchair.gltf`,
    armchair_pillows: `${BASE}/furniture/armchair_pillows.gltf`,
    couch_pillows: `${BASE}/furniture/couch_pillows.gltf`,
    shelf_A_big: `${BASE}/furniture/shelf_A_big.gltf`,
    book_set: `${BASE}/furniture/book_set.gltf`,
    book_single: `${BASE}/furniture/book_single.gltf`,
    cabinet_medium: `${BASE}/furniture/cabinet_medium.gltf`,
    cabinet_medium_decorated: `${BASE}/furniture/cabinet_medium_decorated.gltf`,
    cabinet_small: `${BASE}/furniture/cabinet_small.gltf`,
    lamp_standing: `${BASE}/furniture/lamp_standing.gltf`,
    rug_rectangle_A: `${BASE}/furniture/rug_rectangle_A.gltf`,
    pictureframe_large_A: `${BASE}/furniture/pictureframe_large_A.gltf`,
    pictureframe_large_B: `${BASE}/furniture/pictureframe_large_B.gltf`,
    pictureframe_medium: `${BASE}/furniture/pictureframe_medium.gltf`,
    cactus_medium_A: `${BASE}/furniture/cactus_medium_A.gltf`,
    cactus_small_A: `${BASE}/furniture/cactus_small_A.gltf`,
  },
};

type CategoryKey = keyof AssetManifest;

export class AssetLoader {
  private loader = new GLTFLoader();
  private cache = new Map<string, THREE.Group>();
  private skinned = new Set<string>();
  private animations = new Map<string, THREE.AnimationClip[]>();
  private loaded = false;

  async preload(
    categories: CategoryKey[] = ["characters", "furniture"],
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const entries: [string, string][] = [];
    for (const cat of categories) {
      for (const [key, url] of Object.entries(MANIFEST[cat])) {
        entries.push([`${cat}/${key}`, url]);
      }
    }

    let done = 0;
    const total = entries.length;

    const loadOne = async ([key, url]: [string, string]) => {
      try {
        const gltf = await this.loader.loadAsync(url);
        const model = gltf.scene;
        let hasSkin = false;
        model.traverse(child => {
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            hasSkin = true;
          }
        });
        this.cache.set(key, model);
        if (hasSkin) this.skinned.add(key);
        if (gltf.animations.length > 0) {
          this.animations.set(key, gltf.animations);
        }
      } catch {
        console.warn(`[AssetLoader] Failed to load: ${key} (${url})`);
      }
      done++;
      onProgress?.(done, total);
    };

    const batchSize = 6;
    for (let i = 0; i < entries.length; i += batchSize) {
      await Promise.all(entries.slice(i, i + batchSize).map(loadOne));
    }

    this.loaded = true;
  }

  getModel(category: CategoryKey, key: string): THREE.Group | null {
    const cacheKey = `${category}/${key}`;
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    if (this.skinned.has(cacheKey)) {
      return SkeletonUtils.clone(cached) as THREE.Group;
    }
    return cached.clone();
  }

  getAnimations(category: CategoryKey, key: string): THREE.AnimationClip[] {
    return this.animations.get(`${category}/${key}`) ?? [];
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getCharacterModel(charKey: string): THREE.Group | null {
    return this.getModel("characters", charKey);
  }

  getFurnitureModel(key: string): THREE.Group | null {
    return this.getModel("furniture", key);
  }
}
