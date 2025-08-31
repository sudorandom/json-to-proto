import * as protobuf from 'protobufjs';
import pluralize from 'pluralize';

// Hardcoded minimal descriptor for the Google Well-Known Types we need.
// This avoids issues with `protobuf.common()` in certain bundlers.
export const googleCommonProtos = {
    google: {
        nested: {
            protobuf: {
                nested: {
                    Struct: {
                        fields: {
                            fields: {
                                keyType: "string",
                                type: "Value",
                                id: 1
                            }
                        }
                    },
                    Value: {
                        oneofs: {
                            kind: {
                                oneof: ["nullValue", "numberValue", "stringValue", "boolValue", "structValue", "listValue"]
                            }
                        },
                        fields: {
                            nullValue: {
                                type: "NullValue",
                                id: 1
                            },
                            numberValue: {
                                type: "double",
                                id: 2
                            },
                            stringValue: {
                                type: "string",
                                id: 3
                            },
                            boolValue: {
                                type: "bool",
                                id: 4
                            },
                            structValue: {
                                type: "Struct",
                                id: 5
                            },
                            listValue: {
                                type: "ListValue",
                                id: 6
                            }
                        }
                    },
                    NullValue: {
                        values: {
                            NULL_VALUE: 0
                        }
                    },
                    ListValue: {
                        fields: {
                            values: {
                                rule: "repeated",
                                type: "Value",
                                id: 1
                            }
                        }
                    },
                    Any: {
                        fields: {
                            type_url: {
                                type: "string",
                                id: 1
                            },
                            value: {
                                type: "bytes",
                                id: 2
                            }
                        }
                    }
                }
            }
        }
    }
};


/**
 * Generates a protobufjs Root descriptor from a JSON sample.
 */
export function generateDescriptorFromJson(
  json: any,
  options?: { packageName?: string; messageName?: string; mapHints?: { [parentMsg: string]: string[] } }
): protobuf.Root {
  const packageName = options?.packageName || 'my_package';
  const messageName = options?.messageName || 'RootMessage';
  const mapHints = options?.mapHints || {};
  const messages: Record<string, any> = {};

  function inferFieldType(value: any, fieldName: string, parentMsg: string): { type: string, rule?: string, nested?: any, keyType?: string } {
    if (value === null) return { type: 'google.protobuf.Value' };
    if (Array.isArray(value)) {
      if (value.length === 0) return { type: 'google.protobuf.Any', rule: 'repeated' };
      // If this field is in mapHints for this parent message, treat as map<string, valueType>
      if (mapHints[parentMsg] && mapHints[parentMsg].includes(fieldName)) {
        // Infer the value type from the first element (or fallback to Any)
        let valueType = 'google.protobuf.Any';
        if (value.length > 0) {
          const elemType = inferFieldType(value[0], fieldName, parentMsg);
          valueType = elemType.type;
        }
        return { type: valueType, keyType: 'string', rule: 'map' };
      }
      // If all elements are objects, merge keys
      if (value.every(v => typeof v === 'object' && v !== null && !Array.isArray(v))) {
        // Merge all keys
        const allKeys = Array.from(new Set(value.flatMap(obj => Object.keys(obj))));
        const merged: Record<string, any> = {};
        for (const key of allKeys) {
          merged[key] = value.map(obj => obj[key]);
        }
        const singularFieldName = pluralize.singular(fieldName);
        const nestedMsgName = toPascalCase(singularFieldName);
        messages[nestedMsgName] = buildMessageDescriptor(merged, nestedMsgName);
        return { type: nestedMsgName, rule: 'repeated' };
      }
      // If all elements are arrays, flatten
      if (value.every(v => Array.isArray(v))) {
        // Find max length
        const maxLen = Math.max(...value.map(arr => arr.length));
        const arrFields: Record<string, any> = {};
        for (let i = 0; i < maxLen; i++) {
          arrFields[`_${i}`] = value.map(arr => arr[i]).filter(v => v !== undefined);
        }
        const nestedMsgName = toPascalCase(fieldName);
        messages[nestedMsgName] = buildMessageDescriptor(arrFields, nestedMsgName);
        return { type: nestedMsgName, rule: 'repeated' };
      }
      // Mixed/ambiguous/null types
      const types = new Set(value.map(v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v));
      if (types.size > 1 || types.has('null')) {
        return { type: 'google.protobuf.Value', rule: 'repeated' };
      }
      // Homogeneous array
      const elemType = inferFieldType(value[0], fieldName, parentMsg);
      return { ...elemType, rule: 'repeated' };
    }
    switch (typeof value) {
      case 'string': return { type: 'string' };
      case 'number': return { type: Number.isInteger(value) ? 'int64' : 'double' };
      case 'boolean': return { type: 'bool' };
      case 'object': {
        const nestedMsgName = toPascalCase(fieldName);
        messages[nestedMsgName] = buildMessageDescriptor(value, nestedMsgName);
        return { type: nestedMsgName };
      }
      default: return { type: 'google.protobuf.Any' };
    }
  }

  function buildMessageDescriptor(obj: any, msgName: string): any {
    const fields: Record<string, any> = {};
    let fieldId = 1;
    for (const key of Object.keys(obj)) {
      const fieldType = inferFieldType(obj[key], key, msgName);
      const snakeKey = toSnakeCase(key);
      const fieldDef: any = { type: fieldType.type, id: fieldId++ };
      if (fieldType.rule) fieldDef.rule = fieldType.rule;
      if (fieldType.keyType) fieldDef.keyType = fieldType.keyType;

      const defaultJsonName = snakeToCamel(snakeKey);
      if (key !== defaultJsonName) {
        fieldDef.options = { json_name: key };
      }

      fields[snakeKey] = fieldDef;
    }
    return { fields };
  }

  // Root message
  let rootMsg: any;
  if (typeof json === 'object' && json !== null && !Array.isArray(json)) {
    rootMsg = buildMessageDescriptor(json, messageName);
  } else {
    // Wrap primitive/array/null as { value: ... }
    rootMsg = buildMessageDescriptor({ value: json }, messageName);
  }
  messages[messageName] = rootMsg;

  // Compose nested structure
  let nestedMsgs: Record<string, any> = {};
  for (const [msg, desc] of Object.entries(messages)) {
    nestedMsgs[msg] = desc;
  }
  const descriptor = {
    nested: {
      ...googleCommonProtos,
      [packageName]: {
        nested: nestedMsgs
      }
    }
  };

  // Create Root from a single, merged descriptor.
  const root = protobuf.Root.fromJSON(descriptor);
  root.resolveAll();
  return root;
}

/**
 * Generates .proto content from a protobufjs Root instance.
 */
export function generateProto(root: protobuf.Root): string {
  const lines: string[] = ['syntax = "proto3";', ''];

  // Add necessary imports for Google's well-known types
  const usedTypes = new Set<string>();
  
  function findUsedTypes(ns: protobuf.Namespace) {
      ns.nestedArray.forEach(nested => {
          if (nested instanceof protobuf.Type) {
              nested.fieldsArray.forEach(field => {
                  if (field.resolvedType && field.resolvedType.fullName.startsWith('.google.protobuf.')) {
                      const typeName = field.resolvedType.name;
                      if (typeName === 'Value' || typeName === 'Struct' || typeName === 'ListValue') {
                          usedTypes.add('google/protobuf/struct.proto');
                      } else if (typeName === 'Any') {
                          usedTypes.add('google/protobuf/any.proto');
                      } else if (typeName === 'Timestamp') {
                          usedTypes.add('google/protobuf/timestamp.proto');
                      }
                  }
              });
          } else if (nested instanceof protobuf.Namespace && nested.name !== 'google') {
              findUsedTypes(nested);
          }
      });
  }

  findUsedTypes(root);
  
  usedTypes.forEach(importPath => lines.push(`import "${importPath}";`));
  if (usedTypes.size > 0) lines.push('');


  // Find the first package (namespace) that is not 'google'
  const pkg = (root.nestedArray as (protobuf.Namespace | any)[]).find((n: any) => n instanceof protobuf.Namespace && n.name !== 'google') as protobuf.Namespace | undefined;
  
  if (!pkg) { // Handle case where there's no custom package
      // Fallback to printing all non-google messages if no package is found
      const allTypes = root.nestedArray.filter(n => n instanceof protobuf.Type);
      if (allTypes.length > 0) {
        allTypes.forEach((nestedObj: any) => {
            lines.push(messageToString(nestedObj as protobuf.Type));
        });
      }
      return lines.join('\n');
  }

  lines.push(`package ${pkg.name};`, '');
  
  for (const nestedObj of pkg.nestedArray as (protobuf.Type | any)[]) {
    if (nestedObj instanceof protobuf.Type) {
        lines.push(messageToString(nestedObj));
    }
  }
  return lines.join('\n');
}

function messageToString(msg: protobuf.Type): string {
    const lines: string[] = [];
    lines.push(`message ${msg.name} {`);
    (msg.fieldsArray as protobuf.Field[]).forEach((field: protobuf.Field) => {
    let optionsString = '';
    if (field.options && Object.keys(field.options).length > 0) {
        const opts = Object.entries(field.options)
        .map(([key, value]) => {
          if (typeof value === 'string') return `${key} = "${value}"`;
          return `${key} = ${value}`;
        })
        .join(', ');
        if (opts) {
        optionsString = ` [${opts}]`;
        }
    }
    if (field.map) {
        const mapField = field as unknown as protobuf.MapField;
        lines.push(`  map<${mapField.keyType}, ${mapField.type}> ${mapField.name} = ${mapField.id}${optionsString};`);
    } else {
        const rule = field.repeated ? 'repeated ' : '';
        lines.push(`  ${rule}${field.type} ${field.name} = ${field.id}${optionsString};`);
    }
    });
    lines.push('}', '');
    return lines.join('\n');
}


function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function toPascalCase(str: string): string {
  return str.replace(/(^|_|\s|-)(\w)/g, (_, __, c) => c ? c.toUpperCase() : '').replace(/\W/g, '');
}

function snakeToCamel(str: string): string {
  return str.replace(/_(\w)/g, (_, c) => c.toUpperCase());
}
