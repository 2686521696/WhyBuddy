import { Button, Result } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 任一 key 变化（Object.is 逐位比较）即自动复位——新模型/新会话到来时
   * 不需要用户手动点重试。语义抄 bvaughn/react-error-boundary 的 resetKeys。 */
  resetKeys?: unknown[];
}

interface State {
  didCatch: boolean;
  error: unknown;
}

const initialState: State = { didCatch: false, error: null };

function hasArrayChanged(a: unknown[] = [], b: unknown[] = []) {
  return a.length !== b.length || a.some((item, i) => !Object.is(item, b[i]));
}

/** 应用舞台的防崩溃气囊。
 *
 * 体验层的纪律是 fail-open：任一步失败静默降级、绝不拦闭环——但渲染期
 * 异常此前没有任何边界兜着，一个坏节点就让整个右栏白屏，恰恰违背了这条
 * 纪律。这里补上最后一道：渲染炸了收进诚实降级卡（不影响左侧推演主线），
 * 换个模型/会话自动复位，也可手动重试。
 */
export class AppStageErrorBoundary extends Component<Props, State> {
  state: State = initialState;

  static getDerivedStateFromError(error: unknown): State {
    return { didCatch: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[AppStageErrorBoundary] 应用舞台渲染异常（已捕获）:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (
      this.state.didCatch &&
      prevState.error !== null &&
      hasArrayChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState(initialState);
    }
  }

  private reset = () => {
    this.setState(initialState);
  };

  render() {
    if (!this.state.didCatch) return this.props.children;
    const message =
      this.state.error instanceof Error
        ? this.state.error.message
        : String(this.state.error ?? "未知错误");
    // 2026-07-28：整块手写（lucide 图标 + tailwind 类 + 自己拼的按钮）换成
    // antd Result。降级卡也是应用的一部分，颜色/圆角/按钮形态得跟舞台里其余
    // 组件一致——手写那版的琥珀色和 stone 灰是独立于身份主题的一套。
    return (
      <div role="alert" data-testid="app-stage-error-fallback">
        <Result
          status="warning"
          title="应用舞台渲染失败，已安全降级"
          subTitle={`推演与模型数据不受影响；这是渲染层异常：${message.slice(0, 160)}`}
          extra={
            <Button icon={<ReloadOutlined />} onClick={this.reset}>
              重试渲染
            </Button>
          }
        />
      </div>
    );
  }
}
