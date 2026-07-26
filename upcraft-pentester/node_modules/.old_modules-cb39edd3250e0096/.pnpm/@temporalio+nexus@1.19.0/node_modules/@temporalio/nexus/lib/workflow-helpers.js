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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporalOperationHandler = exports.TemporalOperationResult = exports.WorkflowRunOperationHandler = void 0;
exports.startWorkflow = startWorkflow;
exports.signalWithStartWorkflow = signalWithStartWorkflow;
const nexus = __importStar(require("nexus-rpc"));
const internal_1 = require("@temporalio/client/lib/internal");
const link_converter_1 = require("./link-converter");
const token_1 = require("./token");
const context_1 = require("./context");
/**
 * Starts a workflow run for a {@link WorkflowRunOperationStartHandler}, linking the execution chain
 * to a Nexus Operation (subsequent runs started from continue-as-new and retries). Automatically
 * propagates the callback, request ID, and request and response links from the Nexus options to the
 * Workflow.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
async function startWorkflow(ctx, workflowTypeOrFunc, workflowOptions) {
    const { client, taskQueue } = (0, context_1.getHandlerContext)();
    const links = requestLinksToTemporalLinks(ctx);
    const internalOptions = {
        links,
        requestId: ctx.requestId,
    };
    internalOptions.onConflictOptions = {
        attachLinks: true,
        attachCompletionCallbacks: true,
        attachRequestId: true,
    };
    // Add nexus-operation-token header to solve for race between Workflow completion
    // and Nexus Operation start recording
    const callbackHeaders = {
        ...ctx.callbackHeaders,
        'nexus-operation-token': (0, token_1.generateWorkflowRunOperationToken)(client.options.namespace, workflowOptions.workflowId),
    };
    if (ctx.callbackUrl) {
        internalOptions.completionCallbacks = [
            {
                nexus: { url: ctx.callbackUrl, header: callbackHeaders },
                links, // pass in links here as well for older servers, newer servers dedupe them.
            },
        ];
    }
    const { taskQueue: userSpecifiedTaskQueue, ...rest } = workflowOptions;
    const startOptions = {
        ...rest,
        taskQueue: userSpecifiedTaskQueue || taskQueue,
        [internal_1.InternalWorkflowStartOptionsSymbol]: internalOptions,
    };
    const handle = await client.workflow.start(workflowTypeOrFunc, startOptions);
    if (internalOptions.responseLink != null) {
        pushResponseLink(ctx, internalOptions.responseLink);
    }
    return createWorkflowHandle(ctx, handle.workflowId, handle.firstExecutionRunId);
}
/**
 * Converts the request links carried on the operation start context into Temporal links so
 * they can be forwarded onto an outgoing Workflow RPC (signal, signalWithStart, start). Links that
 * fail to convert are logged and dropped.
 */
function requestLinksToTemporalLinks(ctx) {
    const links = Array();
    if (ctx.inboundLinks?.length > 0) {
        for (const l of ctx.inboundLinks) {
            try {
                links.push((0, link_converter_1.convertNexusLinkToTemporalLink)(l));
            }
            catch (error) {
                context_1.log.warn('failed to convert Nexus link to Workflow event link', { error });
            }
        }
    }
    return links;
}
/**
 * Pushes a response link returned by an outbound Workflow RPC onto the operation's outbound links so
 * the Nexus task handler attaches it to the StartOperationResponse, linking the caller Workflow's
 * NexusOperation history event back to the callee Workflow's event. Callers only invoke this when the
 * server returned a response link; older servers (or CHASM signal response links disabled) leave it
 * unset, in which case there is nothing to push.
 */
function pushResponseLink(ctx, responseLink) {
    try {
        ctx.outboundLinks.push((0, link_converter_1.convertTemporalLinkToNexusLink)(responseLink));
    }
    catch (error) {
        context_1.log.warn('failed to convert temporal link to Nexus link', { error });
    }
}
function createWorkflowHandle(ctx, workflowId, runId) {
    return {
        workflowId,
        runId,
        async signal(def, ...args) {
            const { client } = (0, context_1.getHandlerContext)();
            const links = requestLinksToTemporalLinks(ctx);
            // Signal through a regular WorkflowHandle rather than a dedicated client method, so the Nexus
            // link-forwarding plumbing stays off the public WorkflowClient surface. We attach the request
            // links to the handle via the SDK-internal symbol; the signal handler reads them and writes the
            // server's response link back onto the same payload.
            const handle = client.workflow.getHandle(this.workflowId, this.runId);
            const internalOptions = {
                links,
            };
            handle[internal_1.InternalWorkflowSignalOptionsSymbol] = internalOptions;
            await handle.signal(def, ...args);
            if (internalOptions.responseLink != null) {
                pushResponseLink(ctx, internalOptions.responseLink);
            }
        },
    };
}
/**
 * Signals a Workflow, starting it first if it is not already running, as part of a Nexus Operation.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
async function signalWithStartWorkflow(ctx, workflowTypeOrFunc, workflowOptions) {
    const { client, taskQueue } = (0, context_1.getHandlerContext)();
    const links = requestLinksToTemporalLinks(ctx);
    const internalOptions = {
        links,
    };
    const { taskQueue: userSpecifiedTaskQueue, ...rest } = workflowOptions;
    const signalWithStartOptions = {
        ...rest,
        taskQueue: userSpecifiedTaskQueue || taskQueue,
        [internal_1.InternalWorkflowStartOptionsSymbol]: internalOptions,
    };
    const handle = await client.workflow.signalWithStart(workflowTypeOrFunc, signalWithStartOptions);
    if (internalOptions.responseLink != null) {
        pushResponseLink(ctx, internalOptions.responseLink);
    }
    return {
        workflowId: handle.workflowId,
        runId: handle.signaledRunId,
    };
}
/**
 * A Nexus Operation implementation that is backed by a Workflow run.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
class WorkflowRunOperationHandler {
    handler;
    constructor(handler) {
        this.handler = handler;
    }
    async start(ctx, input) {
        const { namespace } = (0, context_1.getHandlerContext)();
        const handle = await this.handler(ctx, input);
        return nexus.HandlerStartOperationResult.async((0, token_1.generateWorkflowRunOperationToken)(namespace, handle.workflowId));
    }
    async cancel(_ctx, token) {
        const decoded = (0, token_1.loadWorkflowRunOperationToken)(token);
        await (0, context_1.getClient)().workflow.getHandle(decoded.wid).cancel();
    }
}
exports.WorkflowRunOperationHandler = WorkflowRunOperationHandler;
/**
 * Module-private brand and payload key for {@link TemporalOperationResult}.
 */
const operationResult = Symbol('temporal_nexus_TemporalOperationResult');
exports.TemporalOperationResult = {
    sync(value) {
        return {
            [operationResult]: nexus.HandlerStartOperationResult.sync(value),
        };
    },
    async(token) {
        return {
            [operationResult]: nexus.HandlerStartOperationResult.async(token),
        };
    },
};
class TemporalNexusClientImpl {
    startOperationContext;
    asyncOperationStarted = false;
    constructor(startOperationContext) {
        this.startOperationContext = startOperationContext;
    }
    /**
     * The Temporal Client for the active Nexus Operation.
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    get client() {
        return (0, context_1.getClient)();
    }
    /**
     * Create a Nexus-aware handle to an existing Workflow.
     *
     * - If only `workflowId` is passed, and there are multiple Workflow Executions with that ID, the handle will refer to
     *   the most recent one.
     * - If `workflowId` and `runId` are passed, the handle will refer to the specific Workflow Execution with that Run
     *   ID.
     *
     * This method does not validate `workflowId`. If there is no Workflow Execution with the given `workflowId`, handle
     * methods like `handle.signal()` will throw a {@link WorkflowNotFoundError} error.
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    getWorkflowHandle(workflowId, runId) {
        return createWorkflowHandle(this.startOperationContext, workflowId, runId);
    }
    /**
     * Starts a workflow run as the asynchronous backing operation for the current Nexus Operation.
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    async startWorkflow(workflowTypeOrFunc, workflowOptions) {
        return await this.withAsyncOperationStartReservation(async () => {
            const handle = await startWorkflow(this.startOperationContext, workflowTypeOrFunc, workflowOptions);
            const { namespace } = (0, context_1.getHandlerContext)();
            return exports.TemporalOperationResult.async((0, token_1.generateWorkflowRunOperationToken)(namespace, handle.workflowId));
        });
    }
    /**
     * Signals a Workflow, starting it first if it is not already running.
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    async signalWithStartWorkflow(workflowTypeOrFunc, workflowOptions) {
        await signalWithStartWorkflow(this.startOperationContext, workflowTypeOrFunc, workflowOptions);
    }
    async withAsyncOperationStartReservation(fn) {
        if (this.asyncOperationStarted) {
            throw new nexus.HandlerError('BAD_REQUEST', 'Only one async operation can be started per operation handler invocation. Use TemporalNexusClient.client for additional workflow interactions');
        }
        this.asyncOperationStarted = true;
        try {
            return await fn();
        }
        catch (err) {
            this.asyncOperationStarted = false;
            throw err;
        }
    }
}
/**
 * A Nexus Operation implementation for operations that interact with Temporal.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
class TemporalOperationHandler {
    startHandler;
    cancelWorkflowRunHandler;
    constructor(options) {
        this.startHandler = options.start;
        this.cancelWorkflowRunHandler = options.cancelWorkflowRun ?? defaultCancelWorkflowRun;
    }
    async start(ctx, input) {
        const result = await this.startHandler(ctx, new TemporalNexusClientImpl(ctx), input);
        return result[operationResult];
    }
    async cancel(ctx, token) {
        let opToken;
        try {
            opToken = (0, token_1.loadOperationToken)(token);
        }
        catch (err) {
            throw new nexus.HandlerError(nexus.HandlerErrorType.BAD_REQUEST, 'invalid operation token', { cause: err });
        }
        switch (opToken.t) {
            case token_1.OperationTokenType.WORKFLOW_RUN:
                try {
                    (0, token_1.assertWorkflowRunOperationToken)(opToken);
                }
                catch (err) {
                    throw new nexus.HandlerError(nexus.HandlerErrorType.BAD_REQUEST, 'invalid workflow run operation token', {
                        cause: err,
                    });
                }
                await this.cancelWorkflowRunHandler(ctx, { workflowId: opToken.wid });
                return;
            default:
                throw new nexus.HandlerError(nexus.HandlerErrorType.BAD_REQUEST, `Unsupported operation token type: ${opToken.t}`);
        }
    }
}
exports.TemporalOperationHandler = TemporalOperationHandler;
async function defaultCancelWorkflowRun(_ctx, options) {
    await (0, context_1.getClient)().workflow.getHandle(options.workflowId).cancel();
}
//# sourceMappingURL=workflow-helpers.js.map