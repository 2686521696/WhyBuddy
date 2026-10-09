/**
 * 我的额度：余额、兑换码充值、额度明细。照 New API 的「钱包」页（web/src/pages/TopUp）——当前余额、历史消耗、
 * 请求次数，一个兑换码输入框，下面是明细。
 *
 * ⚠ 2026-10-09 积分制（slide-rule-python/services/credit_ledger.py 头注）。入口在左下角账号菜单「额度」。
 *   做成弹窗而不是新视图：视图键在 DashboardApp 里有六处分支，这里加一个就得改六处（CLAUDE.md 四）。
 */
import { Alert, Button, Input, Modal, Space, Statistic, Table, Tag, Typography } from "antd";
import React from "react";

import {
  CREDIT_KIND_LABEL,
  creditsApi,
  describeCreditLog,
  formatCreditTime,
  formatPoints,
  type CreditAccount,
  type CreditLog,
} from "@/lib/credits-client";

const KIND_COLOR: Record<CreditLog["kind"], string> = {
  topup: "green",
  consume: "default",
  manage: "blue",
  system: "purple",
};

export function CreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [account, setAccount] = React.useState<CreditAccount | null>(null);
  const [exempt, setExempt] = React.useState(false);
  const [logs, setLogs] = React.useState<CreditLog[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const load = React.useCallback(async (nextPage: number) => {
    try {
      const [me, page] = await Promise.all([creditsApi.me(), creditsApi.logs(nextPage, 10)]);
      setAccount(me.account);
      setExempt(me.exempt);
      setLogs(page.items);
      setTotal(page.total);
      setPage(nextPage);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "额度读取失败");
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      setNotice("");
      void load(1);
    }
  }, [open, load]);

  const redeem = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setNotice("");
    try {
      const got = await creditsApi.redeem(code);
      setCode("");
      setNotice(`兑换成功，到账 ${formatPoints(got.points)} 积分。`);
      await load(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "兑换失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title="我的额度"
      width={720}
      destroyOnHidden
      data-testid="credits-dialog"
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space size={48} wrap>
          <Statistic
            title="当前余额（积分）"
            value={account ? formatPoints(account.points) : "-"}
            valueStyle={account && account.points <= 0 ? { color: "#cf1322" } : undefined}
          />
          <Statistic title="已用（积分）" value={account ? formatPoints(account.usedPoints) : "-"} />
          <Statistic title="请求次数" value={account?.requestCount ?? "-"} />
        </Space>
        <Typography.Text type="secondary">
          100 积分 = 1 美元。模型调用按 token 计，工程电脑按开机分钟计；余额用完后不能开始新一轮、不能开新电脑。
          {exempt ? " 你是管理员：照常记账，但不会被额度拦住。" : ""}
        </Typography.Text>
        {account && account.points <= 0 && !exempt ? (
          <Alert type="warning" showIcon message="额度已用完，输入兑换码充值，或联系管理员加额度。" />
        ) : null}
        <Space.Compact style={{ width: "100%" }}>
          <Input
            placeholder="输入兑换码"
            value={code}
            onChange={event => setCode(event.target.value)}
            onPressEnter={() => void redeem()}
            maxLength={64}
            data-testid="credits-code"
          />
          <Button type="primary" loading={busy} onClick={() => void redeem()} data-testid="credits-redeem">
            兑换
          </Button>
        </Space.Compact>
        {notice ? <Alert type="success" showIcon message={notice} /> : null}
        {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError("")} /> : null}
        <Table<CreditLog>
          size="small"
          rowKey="id"
          dataSource={logs}
          pagination={{ current: page, pageSize: 10, total, onChange: next => void load(next), size: "small" }}
          columns={[
            { title: "时间", dataIndex: "createdAt", width: 110, render: value => formatCreditTime(value) },
            {
              title: "类型",
              dataIndex: "kind",
              width: 70,
              render: (kind: CreditLog["kind"]) => <Tag color={KIND_COLOR[kind]}>{CREDIT_KIND_LABEL[kind]}</Tag>,
            },
            {
              title: "积分",
              dataIndex: "points",
              width: 90,
              render: (points: number) => (
                <span style={{ color: points < 0 ? undefined : "#389e0d" }}>
                  {points > 0 ? "+" : ""}
                  {formatPoints(points)}
                </span>
              ),
            },
            { title: "说明", key: "what", ellipsis: true, render: (_, row) => describeCreditLog(row) },
          ]}
        />
      </Space>
    </Modal>
  );
}
