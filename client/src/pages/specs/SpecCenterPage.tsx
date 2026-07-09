import { useEffect, useMemo } from "react";

import { useProjectStore } from "@/lib/project-store";
import { blueprintCopy } from "@/lib/blueprint-copy";
import { useAppStore } from "@/lib/store";

import BlueprintProgressPanel from "./BlueprintProgressPanel";

function statusLabel(status: string) {
  switch (status) {
    case "accepted":
      return "已接受";
    case "reviewing":
      return "评审中";
    case "superseded":
      return "已替换";
    default:
      return "草稿";
  }
}

export default function SpecCenterPage() {
  const locale = useAppStore(state => state.locale);
  const setLocale = useAppStore(state => state.setLocale);
  const currentProjectId = useProjectStore(state => state.currentProjectId);
  const projects = useProjectStore(state => state.projects);
  const specs = useProjectStore(state => state.specs);
  const evidence = useProjectStore(state => state.evidence);
  const artifacts = useProjectStore(state => state.artifacts);

  const currentProject = useMemo(
    () => projects.find(project => project.id === currentProjectId) ?? null,
    [currentProjectId, projects]
  );
  const projectSpecs = useMemo(() => {
    if (!currentProject) return [];
    return specs
      .filter(spec => spec.projectId === currentProject.id)
      .sort((left, right) => right.version - left.version);
  }, [currentProject, specs]);
  const currentSpec = useMemo(() => {
    if (!currentProject) return null;
    return (
      projectSpecs.find(spec => spec.id === currentProject.currentSpecId) ??
      projectSpecs.find(spec => spec.status !== "superseded") ??
      null
    );
  }, [currentProject, projectSpecs]);
  const sourceStats = useMemo(() => {
    if (!currentProject) {
      return { evidence: 0, artifacts: 0 };
    }
    return {
      evidence: evidence.filter(item => item.projectId === currentProject.id)
        .length,
      artifacts: artifacts.filter(item => item.projectId === currentProject.id)
        .length,
    };
  }, [artifacts, currentProject, evidence]);

  useEffect(() => {
    if (locale !== "zh-CN") {
      setLocale("zh-CN");
    }
  }, [locale, setLocale]);

  return (
    <main
      className="min-h-screen bg-[#f6f8fb] px-6 py-6 text-slate-950 lg:px-10"
      data-testid="spec-center-page"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
          <div className="text-xs font-black uppercase tracking-normal text-slate-500">
            规格中心
          </div>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black tracking-normal text-slate-950">
                {currentProject?.name ?? "尚未选择项目"}
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">
                {currentProject?.goal
                  ? blueprintCopy(currentProject.goal)
                  : "请先在办公首页创建或选择一个项目。"}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-lg font-black">{projectSpecs.length}</div>
                <div className="text-[10px] font-bold text-slate-500">
                  规格
                </div>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-lg font-black">{sourceStats.evidence}</div>
                <div className="text-[10px] font-bold text-slate-500">
                  证据
                </div>
              </div>
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-lg font-black">
                  {sourceStats.artifacts}
                </div>
                <div className="text-[10px] font-bold text-slate-500">
                  资产
                </div>
              </div>
            </div>
          </div>
        </header>

        {currentProject ? (
          <BlueprintProgressPanel
            projectId={currentProject.id}
            showRouteGeneration={false}
            showSpecProgress={false}
          />
        ) : null}

        <section className="grid min-h-[560px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[24px] border border-slate-200 bg-white p-3 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
            <div className="px-2 py-2 text-xs font-black uppercase tracking-normal text-slate-500">
              版本
            </div>
            <div className="mt-1 grid gap-2">
              {projectSpecs.length ? (
                projectSpecs.map(spec => (
                  <div
                    key={spec.id}
                    className="rounded-[16px] border border-slate-200 bg-slate-50 px-3 py-3"
                    data-testid="spec-center-version-card"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black text-slate-950">
                        v{spec.version} · {blueprintCopy(spec.title)}
                      </span>
                      <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-500">
                        {statusLabel(spec.status)}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-slate-200">
                      <div
                        className="h-1.5 rounded-full bg-[#0f766e]"
                        style={{
                          width: `${Math.round(
                            (spec.completenessDetail?.score ??
                              spec.completeness ??
                              0) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[16px] border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-sm font-semibold text-slate-500">
                  暂无规格草稿
                </div>
              )}
            </div>
          </aside>

          <article className="min-w-0 rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)]">
            {currentSpec ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase tracking-normal text-slate-500">
                      当前规格
                    </div>
                    <h2 className="mt-2 truncate text-xl font-black text-slate-950">
                      v{currentSpec.version} · {blueprintCopy(currentSpec.title)}
                    </h2>
                  </div>
                  <span className="rounded-full bg-[#0f766e]/12 px-3 py-1 text-xs font-black text-[#0f766e]">
                    {Math.round(
                      (currentSpec.completenessDetail?.score ??
                        currentSpec.completeness ??
                        0) * 100
                    )}
                    % 完成
                  </span>
                </div>
                <pre className="mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[18px] border border-slate-200 bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {blueprintCopy(currentSpec.content)}
                </pre>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                  <span>{currentSpec.sourceMessageIds.length} 条消息</span>
                  <span>{currentSpec.sourceEvidenceIds.length} 条证据</span>
                  <span>{currentSpec.sourceArtifactIds.length} 个资产</span>
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[360px] items-center justify-center rounded-[18px] border border-dashed border-slate-300 bg-slate-50 text-center">
                <div>
                  <div className="text-base font-black text-slate-900">
                    暂无规格草稿
                  </div>
                  <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-500">
                    项目澄清和已接受的决策会在这里生成第一版草稿。
                  </p>
                </div>
              </div>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
