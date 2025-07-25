// Utility for protobufjs map field creation
import { Field } from 'protobufjs';

/**
 * Create a protobufjs map field definition
 * @param {string} name - Field name
 * @param {number} id - Field id
 * @param {string} keyType - Key type (e.g. 'string')
 * @param {string} valueType - Value type (e.g. 'string')
 * @returns {Field} - Map field definition
 */
export function createMapField(name: string, id: number, keyType: string, valueType: string) {
  return new Field(name, id, valueType, { keyType, rule: 'map' });
}
