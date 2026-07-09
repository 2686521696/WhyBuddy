import { FileTextOutlined, SafetyCertificateOutlined, ToolOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text, Title } = Typography;

export type SettingsSummary = {
  activeProfile?: string | null;
  fixAgent?: string | null;
  reviewAgent?: string | null;
};

type SummaryCard = {
  key: string;
  label: string;
  value: string;
  icon: ReactNode;
  testId: string;
};

export function SettingsSummaryCards({ summary }: { summary: SettingsSummary }) {
  const { activeProfile = 'local', fixAgent = '-', reviewAgent = '-' } = summary || {};
  const cards: SummaryCard[] = [
    {
      key: 'profile',
      label: '活跃 Profile',
      value: activeProfile || 'local',
      icon: <FileTextOutlined />,
      testId: 'summary-active-profile',
    },
    {
      key: 'review',
      label: 'Review Agent',
      value: reviewAgent || '-',
      icon: <SafetyCertificateOutlined />,
      testId: 'summary-review-agent',
    },
    {
      key: 'fix',
      label: 'Fix Agent',
      value: fixAgent || '-',
      icon: <ToolOutlined />,
      testId: 'summary-fix-agent',
    },
  ];

  return (
    <div className="native-settings-summary-grid">
      {cards.map((card) => (
        <div className="native-settings-summary-card summary-card" key={card.key}>
          <span className="native-settings-summary-icon">{card.icon}</span>
          <span className="native-settings-summary-copy">
            <Text type="secondary">{card.label}</Text>
            <Text strong data-testid={card.testId}>{card.value}</Text>
          </span>
        </div>
      ))}
    </div>
  );
}

export function SettingsPanel({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`native-settings-panel ${className}`.trim()}>
      <div className="native-settings-panel-head">
        <Title level={5}>{title}</Title>
        {description ? <Text type="secondary">{description}</Text> : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsLayout({
  title = 'AgentLoop 设置中心',
  summary,
  tabs,
  footer,
}: {
  title?: string;
  summary?: SettingsSummary;
  tabs: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="native-settings-shell">
      <div className="native-settings-title">
        <Title level={3}>{title}</Title>
      </div>
      {summary && <SettingsSummaryCards summary={summary} />}
      <div className="native-settings-tabs-wrap">{tabs}</div>
      {footer}
    </section>
  );
}

export default SettingsLayout;
