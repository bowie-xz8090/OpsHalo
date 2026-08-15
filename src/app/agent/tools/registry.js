const { z } = require('zod')
const { ToolDefinitionSchema } = require('../schemas/tool-schema')
const { selectPublicTools } = require('./tool-selector')

class ToolRegistry {
  constructor () {
    this.tools = new Map()
    this.validators = new Map()
  }

  register (definition, executor) {
    const parsed = ToolDefinitionSchema.parse(definition)
    if (this.tools.has(parsed.name)) throw new Error(`Tool already registered: ${parsed.name}`)
    let inputValidator
    let resultValidator
    try {
      inputValidator = z.fromJSONSchema(parsed.inputSchema)
      resultValidator = z.fromJSONSchema(parsed.resultSchema)
    } catch (error) {
      const wrapped = new Error(`Invalid JSON Schema for ${parsed.name}: ${error.message}`)
      wrapped.code = 'AGENT_INVALID_TOOL_SCHEMA'
      throw wrapped
    }
    this.tools.set(parsed.name, { definition: parsed, executor })
    this.validators.set(parsed.name, { input: inputValidator, result: resultValidator })
    return parsed
  }

  registerConservativeMcp (name, inputSchema, executor, metadata = {}) {
    const mutabilityKnown = ['none', 'reversible', 'destructive'].includes(metadata.mutability)
    return this.register({
      schemaVersion: 1,
      name: `mcp.${name.replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase()}`,
      version: String(metadata.version || '1'),
      description: metadata.description || `External MCP tool ${name}`,
      category: 'network',
      mutability: mutabilityKnown ? metadata.mutability : 'reversible',
      riskFloor: mutabilityKnown && metadata.mutability !== 'none' ? 'R3' : 'R2',
      sensitivityFloor: metadata.sensitivityFloor || 'S2',
      costFloor: metadata.costFloor || 'C2',
      approval: mutabilityKnown ? 'policy' : 'always',
      defaultTimeoutMs: Math.min(metadata.defaultTimeoutMs || 30000, 60000),
      maxTimeoutMs: Math.min(metadata.maxTimeoutMs || 60000, 120000),
      maxRawCaptureBytes: Math.min(metadata.maxRawCaptureBytes || 2 * 1024 * 1024, 2 * 1024 * 1024),
      maxModelOutputBytes: Math.min(metadata.maxModelOutputBytes || 6144, 8192),
      supportsCancel: metadata.supportsCancel === true,
      supportsDryRun: metadata.supportsDryRun === true,
      inputSchema: inputSchema || { type: 'object', additionalProperties: false },
      resultSchema: metadata.resultSchema || { type: 'object' },
      parserId: metadata.parserId || 'mcp'
    }, executor)
  }

  get (name) {
    const item = this.tools.get(name)
    if (!item) {
      const error = new Error(`Unknown tool: ${name}`)
      error.code = 'AGENT_UNKNOWN_TOOL'
      throw error
    }
    return item
  }

  validateInput (name, value) {
    return this.validators.get(name).input.parse(value)
  }

  validateResult (name, value) {
    return this.validators.get(name).result.parse(value)
  }

  publicDescriptors (context) {
    const descriptors = [...this.tools.values()].map(({ definition }) => ({
      name: definition.name,
      version: definition.version,
      description: definition.description,
      category: definition.category,
      mutability: definition.mutability,
      riskFloor: definition.riskFloor,
      sensitivityFloor: definition.sensitivityFloor,
      costFloor: definition.costFloor,
      verificationRequired: definition.mutability !== 'none' && definition.category !== 'interactive',
      inputSchema: definition.inputSchema,
      publicBounds: [
        `timeout<=${definition.maxTimeoutMs}ms`,
        `model_output<=${definition.maxModelOutputBytes}bytes`
      ]
    }))
    return context ? selectPublicTools(descriptors, context) : descriptors
  }
}

module.exports = { ToolRegistry }
