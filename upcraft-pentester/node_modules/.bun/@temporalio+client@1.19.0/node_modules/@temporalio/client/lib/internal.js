"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalWorkflowSignalOptionsSymbol = exports.InternalWorkflowStartOptionsSymbol = void 0;
/**
 * A symbol used to attach extra, SDK-internal options to the `WorkflowClient.start()` call.
 *
 * These are notably used by the Temporal Nexus helpers.
 *
 * @internal
 * @hidden
 */
exports.InternalWorkflowStartOptionsSymbol = Symbol.for('__temporal_internal_client_workflow_start_options');
/**
 * A symbol used to attach extra, SDK-internal options to a `WorkflowHandle.signal()` call.
 *
 * Used by the Temporal Nexus helpers to forward request links onto the signal request
 * and to capture the response link returned on the SignalWorkflowExecutionResponse.
 *
 * @internal
 * @hidden
 */
exports.InternalWorkflowSignalOptionsSymbol = Symbol.for('__temporal_internal_client_workflow_signal_options');
//# sourceMappingURL=internal.js.map