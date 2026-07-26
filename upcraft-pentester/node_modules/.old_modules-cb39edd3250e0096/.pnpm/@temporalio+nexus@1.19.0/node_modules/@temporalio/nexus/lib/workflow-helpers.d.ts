import * as nexus from 'nexus-rpc';
import type { Workflow, WorkflowResultType, WithWorkflowArgs, SignalDefinition } from '@temporalio/common';
import type { Replace } from '@temporalio/common/lib/type-helpers';
import type { Client, WorkflowStartOptions as ClientWorkflowStartOptions, WorkflowSignalWithStartOptions as ClientWorkflowSignalWithStartOptions } from '@temporalio/client';
import { type TemporalCancelOperationContext, type TemporalStartOperationContext } from './context';
declare const isNexusWorkflowHandle: unique symbol;
declare const workflowResultType: unique symbol;
/**
 * A handle to a running workflow that is returned by the {@link startWorkflow} helper.
 * This handle should be returned by {@link WorkflowRunOperationStartHandler} implementations.
 *
 * The type parameter `T` carries the workflow's result type for downstream type inference in
 * {@link WorkflowRunOperationHandler}. It is encoded in the {@link workflowResultType} brand so
 * that `WorkflowHandle<string>` and `WorkflowHandle<number>` are structurally distinct.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export interface WorkflowHandle<T> {
    readonly workflowId: string;
    readonly runId?: string;
    signal<Args extends any[] = [], Name extends string = string>(def: SignalDefinition<Args, Name> | string, ...args: Args): Promise<void>;
    /**
     * Virtual type brand to maintain a distinction between {@link WorkflowHandle} provided by the
     * {@link startWorkflow} helper (which will have attached links, request ID, completion URL, etc)
     * and the `WorkflowHandle` type returned by the {@link WorkflowClient.start}.
     *
     * @internal
     * @hidden
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    readonly [isNexusWorkflowHandle]: typeof isNexusWorkflowHandle;
    /**
     * Type brand that carries the workflow's result type, making `WorkflowHandle<X>` structurally
     * distinct from `WorkflowHandle<Y>` so TypeScript can catch type mismatches.
     *
     * @internal
     * @hidden
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    readonly [workflowResultType]: T;
}
/**
 * Options for starting a workflow using {@link startWorkflow}, this type is identical to the
 * client's `WorkflowStartOptions` with the exception that `taskQueue` is optional and defaults
 * to the current worker's task queue.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export type WorkflowStartOptions<T extends Workflow> = Replace<ClientWorkflowStartOptions<T>, {
    taskQueue?: string;
}>;
/**
 * Starts a workflow run for a {@link WorkflowRunOperationStartHandler}, linking the execution chain
 * to a Nexus Operation (subsequent runs started from continue-as-new and retries). Automatically
 * propagates the callback, request ID, and request and response links from the Nexus options to the
 * Workflow.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export declare function startWorkflow<T extends Workflow>(ctx: nexus.StartOperationContext, workflowTypeOrFunc: string | T, workflowOptions: WorkflowStartOptions<T>): Promise<WorkflowHandle<WorkflowResultType<T>>>;
/**
 * Options for {@link signalWithStartWorkflow}, identical to the client's `WorkflowSignalWithStartOptions`
 * except that `taskQueue` is optional and defaults to the current worker's task queue.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export type WorkflowSignalWithStartOptions<SignalArgs extends any[] = []> = Replace<ClientWorkflowSignalWithStartOptions<SignalArgs>, {
    taskQueue?: string;
}>;
/**
 * Signals a Workflow, starting it first if it is not already running, as part of a Nexus Operation.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export declare function signalWithStartWorkflow<T extends Workflow, SignalArgs extends any[] = []>(ctx: nexus.StartOperationContext, workflowTypeOrFunc: string | T, workflowOptions: WithWorkflowArgs<T, WorkflowSignalWithStartOptions<SignalArgs>>): Promise<WorkflowHandle<WorkflowResultType<T>>>;
/**
 * A handler function for the {@link WorkflowRunOperationHandler} constructor.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export type WorkflowRunOperationStartHandler<I, O> = (ctx: nexus.StartOperationContext, input: I) => Promise<WorkflowHandle<O>>;
/**
 * A Nexus Operation implementation that is backed by a Workflow run.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export declare class WorkflowRunOperationHandler<I, O> implements nexus.OperationHandler<I, O> {
    readonly handler: WorkflowRunOperationStartHandler<I, O>;
    constructor(handler: WorkflowRunOperationStartHandler<I, O>);
    start(ctx: nexus.StartOperationContext, input: I): Promise<nexus.HandlerStartOperationResult<O>>;
    cancel(_ctx: nexus.CancelOperationContext, token: string): Promise<void>;
}
/**
 * Module-private brand and payload key for {@link TemporalOperationResult}.
 */
declare const operationResult: unique symbol;
/**
 * A result produced by a {@link TemporalOperationHandler}. Construct via
 * {@link TemporalOperationResult.sync} or {@link TemporalOperationResult.async}.

 * @experimental Nexus support in Temporal SDK is experimental.
 */
export interface TemporalOperationResult<T> {
    readonly [operationResult]: nexus.HandlerStartOperationResult<T>;
}
export declare const TemporalOperationResult: {
    sync<T>(value: T): TemporalOperationResult<T>;
    async<T = unknown>(token: string): TemporalOperationResult<T>;
};
/**
 * A Nexus-aware Temporal Client for use inside {@link TemporalOperationHandler} implementations.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export interface TemporalNexusClient {
    /**
     * The Temporal Client for the active Nexus Operation.
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    readonly client: Client;
    /**
     * Starts a workflow run as the asynchronous backing operation for the current Nexus Operation.
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    startWorkflow<T extends Workflow>(workflowTypeOrFunc: string | T, workflowOptions: WorkflowStartOptions<T>): Promise<TemporalOperationResult<WorkflowResultType<T>>>;
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
    getWorkflowHandle<T extends Workflow>(workflowId: string, runId?: string): WorkflowHandle<WorkflowResultType<T>>;
    /**
     * Signals a Workflow, starting it first if it is not already running, forwarding the Nexus
     * Operation's request links and propagating the response link the server returns (when supported).
     *
     * @experimental Nexus support in Temporal SDK is experimental.
     */
    signalWithStartWorkflow<T extends Workflow, SignalArgs extends any[] = []>(workflowTypeOrFunc: string | T, workflowOptions: WithWorkflowArgs<T, WorkflowSignalWithStartOptions<SignalArgs>>): Promise<void>;
}
/**
 * A handler function for the {@link TemporalOperationHandler} constructor.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export type TemporalOperationStartHandler<I, O> = (ctx: TemporalStartOperationContext, client: TemporalNexusClient, input: I) => Promise<TemporalOperationResult<O>>;
/**
 * Options passed to a {@link TemporalOperationHandlerOptions.cancelWorkflowRun} handler describing
 * the workflow run to cancel.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export interface CancelWorkflowRunOptions {
    /**
     * The ID of the workflow backing the Nexus Operation that is being canceled.
     */
    readonly workflowId: string;
}
/**
 * Options for customizing a {@link TemporalOperationHandler}.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export interface TemporalOperationHandlerOptions {
    cancelWorkflowRun?: (ctx: TemporalCancelOperationContext, options: CancelWorkflowRunOptions) => Promise<void>;
}
/**
 * A Nexus Operation implementation for operations that interact with Temporal.
 *
 * @experimental Nexus support in Temporal SDK is experimental.
 */
export declare class TemporalOperationHandler<I, O> implements nexus.OperationHandler<I, O> {
    private readonly startHandler;
    private readonly cancelWorkflowRunHandler;
    constructor(options: {
        start: TemporalOperationStartHandler<I, O>;
    } & TemporalOperationHandlerOptions);
    start(ctx: nexus.StartOperationContext, input: I): Promise<nexus.HandlerStartOperationResult<O>>;
    cancel(ctx: nexus.CancelOperationContext, token: string): Promise<void>;
}
export {};
