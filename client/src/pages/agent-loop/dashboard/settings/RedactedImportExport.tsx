import { Alert, Button, Space, Typography, Upload, message } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { RedactedImportExportProps } from './types';

const { Text } = Typography;

// Shared redacted import/export body for settings.
export function RedactedImportExport({ exportedSettings, importResult, onExportSettings, onImportSettings }: RedactedImportExportProps) {
  return (
    <Space direction="vertical" className="native-stack">
      <Space wrap>
        <Button icon={<DownloadOutlined />} onClick={() => onExportSettings && onExportSettings()}>
          导出设置（仅 activeProfile、非敏感、key 状态）
        </Button>
        <Upload
          accept=".json,application/json"
          showUploadList={false}
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              const text = (event.target && (event.target as any).result) || '';
              if (text) onImportSettings && onImportSettings(String(text));
            };
            reader.readAsText(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>导入设置（文件上传）</Button>
        </Upload>
      </Space>

      {exportedSettings && (
        <div className="native-settings-export-preview">
          <Text strong>导出内容（secret 字段为状态，非明文）:</Text>
          <pre>{JSON.stringify(exportedSettings, null, 2)}</pre>
          <Space size={8}>
            <Button size="small" onClick={() => { try { navigator.clipboard?.writeText(JSON.stringify(exportedSettings, null, 2)); message.success('已复制'); } catch {} }}>复制</Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => {
                try {
                  const dataStr = JSON.stringify(exportedSettings, null, 2);
                  const blob = new Blob([dataStr], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement('a');
                  anchor.href = url;
                  anchor.download = 'agentloop-settings-redacted.json';
                  document.body.appendChild(anchor);
                  anchor.click();
                  document.body.removeChild(anchor);
                  URL.revokeObjectURL(url);
                  message.success('已下载');
                } catch {}
              }}
            >
              下载文件
            </Button>
          </Space>
        </div>
      )}

      {importResult ? (
        <div className="native-settings-import-result">
          {importResult.ok ? (
            <Alert type="success" showIcon message="导入成功" />
          ) : (
            <Alert type="error" showIcon message={importResult.error || '导入失败'} />
          )}
        </div>
      ) : null}
    </Space>
  );
}

export { RedactedImportExport as RedactedImportExportPanel };
export default RedactedImportExport;
