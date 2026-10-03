/**
 * 结果卡那张缩略图。
 *
 * ## 两份诚实来源（2026-09-19）
 *
 * 第一份仍是验收：`project_verify` 的 PNG。stale 不算——那是上一版源码
 * （2026-09-14 待办清单那趟，§7 不许拿旧证据充新产出）。
 *
 * ⚠ 2026-09-19 飞机大战 `sr-20260919163941-977KTNMZ0K`：验收接口
 *   `snapshot: null`，`project_verify` 一次没调。`browser_view` 看了三
 *   次，回执里却没有图，完成卡空白。第二份来源是模型看过页面时落下的
 *   预览截图（`/projects/{id}/preview-snapshot`）。**不是验收通过**，
 *   有验收且当前这一版能画时仍用验收那张。
 *
 * HTML 原型的 freeform-preview、占位图，仍然不许凑。
 *
 * ## 为什么直接把端点 URL 交给 `<img>`
 *
 * `ProjectEvidenceImages` 走 fetch + PNG 签名校验 + 体积上限，那是因为它要把
 * 字节变成 objectURL 自己管生命周期。缩略图不需要——同源 `<img>` 会自动带
 * cookie，而端点已经钉死 `Content-Type: image/png` + `X-Content-Type-Options:
 * nosniff`，浏览器不会把它当别的东西执行。再抄一遍取数逻辑就是 §4 那条
 * 「同一件事两份实现」。
 */
import { useEffect, useState } from "react";
import {
  getProjectVerification,
  type ProjectVerificationView,
} from "./project-verification-client";
import {
  displayableScreenshots,
  verificationArtifactUrl,
} from "./verification-artifacts";

export function previewSnapshotUrl(projectId: string): string {
  return (
    `/api/sliderule/projects/${encodeURIComponent(projectId)}` +
    `/preview-snapshot`
  );
}

/**
 * 从一份验收视图里挑出能当缩略图的那张；挑不出来就是 null。
 *
 * 单独拎成纯函数，判据才能直接喂**真机那一发的原样载荷**（§一之二）——
 * 包在 hook 里就只能靠渲染去间接试，而那种判据证明不了「stale 这一支真的走到」。
 */
export function thumbnailFromVerification(
  view: ProjectVerificationView | null | undefined
): string | null {
  // ⚠ 2026-09-14 真机（待办清单那趟）翻出来的：验收面板显示
  //   「旧版本记录，需重新检查」——`effectiveStatus === "stale"`，
  //   意思是**有**一份验收记录，但它拍的是上一版源码。那份截图挂到写着
  //   「工作了 55s」的这一轮卡片上，就是拿旧证据冒充新产出
  //   （§7 闭环类 fail-closed：缺证据就是缺，不许伪造绿灯）。
  if (!view?.snapshot || view.snapshot.effectiveStatus === "stale") return null;
  const record = view.snapshot.verification;
  const ref = displayableScreenshots(record?.artifactRefs)[0];
  if (!record || !ref) return null;
  return verificationArtifactUrl(record.verificationId, ref.artifactId);
}

/** 有验收用验收；否则才用预览截图。两边都没有就是 null。 */
export function resolveProjectThumbnail(input: {
  verification: ProjectVerificationView | null | undefined;
  previewAvailable: boolean;
  projectId: string | null | undefined;
}): string | null {
  const verified = thumbnailFromVerification(input.verification);
  if (verified) return verified;
  const id = String(input.projectId || "").trim();
  if (input.previewAvailable && id) return previewSnapshotUrl(id);
  return null;
}

/**
 * 预览截图在不在：用 Image 预加载，不用 fetch。
 *
 * ⚠ 2026-10-03「我的应用」网页卡太慢才出图：原来先 fetch 整张 PNG（no-store）只为看 content-type，
 *   <img> 显示时再下一遍——一张卡同一张图下两次。Image 预加载的那份，同一 URL 的 <img> 直接复用。
 */
function imageLoads(url: string, signal: AbortSignal): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof Image === "undefined") return resolve(false);
    const img = new Image();
    const done = (ok: boolean) => {
      signal.removeEventListener("abort", stop);
      resolve(ok);
    };
    const stop = () => {
      img.src = "";
      done(false);
    };
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    signal.addEventListener("abort", stop);
    img.src = url;
  });
}

/**
 * 取缩略图，并说清还在不在找：`loading` 为 true 时卡片该画占位，不该写「还没有页面截图」。
 * ⚠ 2026-10-03 用户截图：网页卡先一律显示「还没有页面截图」，过好一阵图才冒出来——看着像没图。
 */
export function useProjectThumbnailState(
  projectId: string | null | undefined
): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>(() => ({
    url: null,
    loading: Boolean(String(projectId || "").trim()),
  }));

  useEffect(() => {
    const id = String(projectId || "").trim();
    setState({ url: null, loading: Boolean(id) });
    if (!id) return;

    const controller = new AbortController();
    (async () => {
      let verification: ProjectVerificationView | null = null;
      try {
        verification = await getProjectVerification(id, controller.signal);
      } catch {
        // 验收拿不到就试预览图。缩略图缺席不许让结果卡本身出问题。
      }
      if (controller.signal.aborted) return;
      const verified = thumbnailFromVerification(verification);
      if (verified) {
        setState({ url: verified, loading: false });
        return;
      }
      const shot = previewSnapshotUrl(id);
      const ok = await imageLoads(shot, controller.signal);
      if (controller.signal.aborted) return;
      setState({
        url: ok ? resolveProjectThumbnail({ verification: null, previewAvailable: true, projectId: id }) : null,
        loading: false,
      });
    })();
    return () => controller.abort();
  }, [projectId]);

  return state;
}

/** 取结果卡缩略图；没有就是 null。 */
export function useProjectThumbnail(
  projectId: string | null | undefined
): string | null {
  return useProjectThumbnailState(projectId).url;
}
