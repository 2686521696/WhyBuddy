"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunController = void 0;
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const paths_1 = require("./paths");
class RunController {
    repoRoot;
    output;
    onStarted;
    onFinished;
    child = null;
    constructor(repoRoot, output, onStarted, onFinished) {
        this.repoRoot = repoRoot;
        this.output = output;
        this.onStarted = onStarted;
        this.onFinished = onFinished;
    }
    get running() {
        return this.child !== null;
    }
    async runQueue() {
        if (this.child) {
            vscode.window.showWarningMessage('AgentLoop 队列已在运行中。');
            return;
        }
        const agentLoopRoot = (0, paths_1.getAgentLoopRoot)(this.repoRoot);
        const scriptPath = path.join(agentLoopRoot, 'scripts', 'run-queue.mjs');
        this.output.show(true);
        this.output.appendLine(`[${new Date().toLocaleTimeString()}] 启动 run-queue: node ${scriptPath}`);
        this.onStarted();
        const child = (0, node_child_process_1.spawn)(process.execPath, [scriptPath], {
            cwd: agentLoopRoot,
            env: {
                ...process.env,
                AGENT_LOOP_PROGRESS: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.child = child;
        child.stdout?.on('data', (chunk) => {
            this.output.append(chunk.toString());
        });
        child.stderr?.on('data', (chunk) => {
            this.output.append(chunk.toString());
        });
        child.on('close', (code) => {
            this.output.appendLine(`[${new Date().toLocaleTimeString()}] run-queue 结束，exit=${code ?? 'null'}`);
            this.child = null;
            this.onFinished(code);
        });
        child.on('error', (error) => {
            this.output.appendLine(`run-queue 启动失败: ${error.message}`);
            this.child = null;
            this.onFinished(null);
        });
    }
    stop() {
        if (!this.child)
            return;
        this.output.appendLine(`[${new Date().toLocaleTimeString()}] 请求停止 run-queue`);
        this.child.kill('SIGTERM');
    }
    dispose() {
        this.stop();
    }
}
exports.RunController = RunController;
//# sourceMappingURL=runController.js.map