/**
 * 结果卡那张缩略图：取**最近一次验收跑出来的页面截图**。
 *
 * ## 为什么是验收产物，不是另外截一张（2026-09-14）
 *
 * 对照 Manus，结果卡里那张大图是感知最强的一块。我们这边一直是空的，
 * 头注里写着「拿不到就不画，不从别处凑」。
 *
 * 能凑的两条路都试过：
 *   · `services/app_screenshot.py` 只在**生成过程里做自检**用，截的是
 *     HTML 原型的 freeform-preview，没落成会话级产物，而且工程档根本不走它。
 *   · 直接截 E2B 里跑着的应用 —— 那要预览网关（通配符域名 + TLS），
 *     本机给不了。
 *
 * 真正现成的是第三条：`project_verify` 的浏览器套件**跑在 E2B 内部**，
 * 不需要任何公网路由，产出 `VerificationArtifactRef`（image/png + sha256 + label），
 * 取图端点 `/project-verifications/{vid}/artifacts/{aid}` 是 owner 校验过的，
 * `ProjectEvidenceImages` 早就在用它。**这是真机上真的跑得出来的那张图。**
 *
 * ⚠ 所以缩略图**只有跑过验收才有**，而且只认**当前这一版**的那份。
 *   没跑过、或者只有一份过期的（stale），都是 null，卡片那一块不画——
 *   这是诚实的「还没有」，不是坏掉（§7：没有证据的地方不编）。
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
  ProjectVerificationError,
  getProjectVerification,
  type ProjectVerificationView,
} from "./project-verification-client";
import {
  displayableScreenshots,
  verificationArtifactUrl,
} from "./verification-artifacts";

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

/** 取最近一次验收的第一张截图地址；没有就是 null。 */
export function useProjectThumbnail(
  projectId: string | null | undefined
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const id = String(projectId || "").trim();
    setUrl(null);
    if (!id) return;

    const controller = new AbortController();
    (async () => {
      try {
        const found = thumbnailFromVerification(
          await getProjectVerification(id, controller.signal)
        );
        if (found) setUrl(found);
      } catch (error) {
        // ⚠ 拿不到就是没有：验收没跑过、被取消、无权限，都走这一支。
        //   §7 增强类 fail-open——缩略图缺席不许让结果卡本身出问题。
        if (!(error instanceof ProjectVerificationError)) return;
      }
    })();
    return () => controller.abort();
  }, [projectId]);

  return url;
}
