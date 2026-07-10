/**
 * SpotAllocator — ensures resting NPCs don't overlap.
 *
 * Vendored from Agentshire (https://github.com/Agentshire/Agentshire,
 * MIT License, commit f54a798) — town-frontend/src/npc/SpotAllocator.ts,
 * verbatim except formatting. 环形探位：目标点被占则按半径环逐圈找空位。
 *
 * Call allocate() before dispatching a moveTo to get a non-overlapping
 * final position. Orchestrator / workstation moves should bypass this
 * and use raw coordinates directly.
 */

const TWO_PI = Math.PI * 2;

export class SpotAllocator {
  private occupied = new Map<string, { x: number; z: number }>();

  allocate(
    desired: { x: number; z: number },
    npcId: string,
    minGap = 0.8
  ): { x: number; z: number } {
    this.occupied.delete(npcId);

    if (!this.hasConflict(desired, npcId, minGap)) {
      this.occupied.set(npcId, desired);
      return desired;
    }

    for (let ring = 1; ring <= 5; ring++) {
      const radius = ring * minGap;
      const count = ring * 6;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * TWO_PI;
        const candidate = {
          x: desired.x + Math.cos(angle) * radius,
          z: desired.z + Math.sin(angle) * radius,
        };
        if (!this.hasConflict(candidate, npcId, minGap)) {
          this.occupied.set(npcId, candidate);
          return candidate;
        }
      }
    }

    this.occupied.set(npcId, desired);
    return desired;
  }

  release(npcId: string): void {
    this.occupied.delete(npcId);
  }

  clear(): void {
    this.occupied.clear();
  }

  private hasConflict(
    pos: { x: number; z: number },
    selfId: string,
    minGap: number
  ): boolean {
    const gapSq = minGap * minGap;
    for (const [id, other] of this.occupied) {
      if (id === selfId) continue;
      const dx = pos.x - other.x;
      const dz = pos.z - other.z;
      if (dx * dx + dz * dz < gapSq) return true;
    }
    return false;
  }
}
