/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { RelationField, Context } from "../types";
import { Node, Relationship } from "../classes";
import createAuthAndParams from "./create-auth-and-params";
import { AUTH_FORBIDDEN_ERROR } from "../constants";
import { asArray, omitFields } from "../utils/utils";
import * as CypherBuilder from "./cypher-builder/CypherBuilder";
import { convertToCypherParams } from "./cypher-builder/utils";

type CreateOrConnectInput = {
    where?: {
        node: Record<string, any>;
    };
    onCreate?: {
        node?: Record<string, any>;
        edge?: Record<string, any>;
    };
};

export function createConnectOrCreateAndParams({
    input,
    varName,
    parentVar,
    relationField,
    refNode,
    context,
    withVars,
}: {
    input: CreateOrConnectInput[] | CreateOrConnectInput;
    varName: string;
    parentVar: string;
    relationField: RelationField;
    refNode: Node;
    context: Context;
    withVars: string[];
}): CypherBuilder.CypherResult {
    const statements = asArray(input).map((inputItem, index) => {
        const subqueryBaseName = `${varName}${index}`;
        const result = createConnectOrCreatePartialStatement({
            input: inputItem,
            baseName: subqueryBaseName,
            parentVar,
            relationField,
            refNode,
            context,
        });
        return result;
    });

    const query = statements.reduce((result, statement) => {
        result.concat(statement);
        return result;
    }, new CypherBuilder.Query());

    return new CypherBuilder.Call(query, withVars).build(`${varName}_`);
}

function createConnectOrCreatePartialStatement({
    input,
    baseName,
    parentVar,
    relationField,
    refNode,
    context,
}: {
    input: CreateOrConnectInput;
    baseName: string;
    parentVar: string;
    relationField: RelationField;
    refNode: Node;
    context: Context;
}): CypherBuilder.Query {
    const mergeQuery = mergeStatement({
        input,
        refNode,
        context,
        relationField,
        parentNode: new CypherBuilder.NamedNode(parentVar),
    });

    const authQuery = createAuthStatement({
        node: refNode,
        context,
        nodeName: baseName,
    });

    return new CypherBuilder.Query().concat(authQuery).concat(mergeQuery);
}

function getCypherParameters(
    onCreateParams: Record<string, any> = {},
    node?: Node
): Record<string, CypherBuilder.Param<any>> {
    const params = Object.entries(onCreateParams).reduce((acc, [key, value]) => {
        const nodeField = node?.constrainableFields.find((f) => f.fieldName === key);
        const nodeFieldName = nodeField?.dbPropertyName || nodeField?.fieldName;
        const fieldName = nodeFieldName || key;
        const valueOrArray = nodeField?.typeMeta.array ? asArray(value) : value;
        acc[fieldName] = valueOrArray;
        return acc;
    }, {});
    return convertToCypherParams(params);
}
function mergeStatement({
    input,
    refNode,
    context,
    relationField,
    parentNode,
}: {
    input: CreateOrConnectInput;
    refNode: Node;
    context: Context;
    relationField: RelationField;
    parentNode: CypherBuilder.Node;
}): CypherBuilder.Query {
    const whereNodeParameters = getCypherParameters(input.where?.node, refNode);
    const onCreateNodeParameters = getCypherParameters(input.onCreate?.node, refNode);

    const autogeneratedParams = getAutogeneratedParams(refNode);
    const node = new CypherBuilder.Node({
        labels: refNode.getLabels(context),
        parameters: whereNodeParameters,
    });

    const unsetAutogeneratedParams = omitFields(autogeneratedParams, Object.keys(whereNodeParameters));
    const merge = new CypherBuilder.Merge(node).onCreate({
        ...unsetAutogeneratedParams,
        ...onCreateNodeParameters,
    });

    const relationshipFields = context.relationships.find((x) => x.properties === relationField.properties);
    const autogeneratedRelationshipParams = relationshipFields ? getAutogeneratedParams(relationshipFields) : {};
    const onCreateRelationshipParams = convertToCypherParams(input.onCreate?.edge || {});

    const relationship = new CypherBuilder.Relationship({
        source: relationField.direction === "IN" ? node : parentNode,
        target: relationField.direction === "IN" ? parentNode : node,
        type: relationField.type,
    });

    const relationshipMerge = new CypherBuilder.Merge(relationship).onCreate({
        relationship: { ...autogeneratedRelationshipParams, ...onCreateRelationshipParams },
    });
    merge.concat(relationshipMerge);
    return merge;
}

function createAuthStatement({
    node,
    context,
    nodeName,
}: {
    node: Node;
    context: Context;
    nodeName: string;
}): CypherBuilder.Query | undefined {
    if (!node.auth) return undefined;

    const auth = createAuthAndParams({
        entity: node,
        operations: ["CONNECT", "CREATE"],
        context,
        allow: { parentNode: node, varName: nodeName, chainStr: `${nodeName}${node.name}_allow` },
        escapeQuotes: false,
    });

    if (!auth[0]) return undefined;

    const query = new CypherBuilder.Apoc.Validate({
        predicate: `NOT(${auth[0]})`,
        message: AUTH_FORBIDDEN_ERROR,
    });
    query.addNamedParams(convertToCypherParams(auth[1] as Record<string, any>));
    return query;
}

// Helper for compatibility reasons
function getAutogeneratedParams(node: Node | Relationship): Record<string, CypherBuilder.Param<any>> {
    const autogeneratedFields = node.primitiveFields
        .filter((f) => f.autogenerate)
        .reduce((acc, field) => {
            if (field.dbPropertyName) {
                acc[field.dbPropertyName] = new CypherBuilder.RawParam("randomUUID()");
            }
            return acc;
        }, {});

    const autogeneratedTemporalFields = node.temporalFields
        .filter((field) => ["DateTime", "Time"].includes(field.typeMeta.name) && field.timestamps?.includes("CREATE"))
        .reduce((acc, field) => {
            if (field.dbPropertyName) {
                acc[field.dbPropertyName] = new CypherBuilder.RawParam(`${field.typeMeta.name.toLowerCase()}()`);
            }
            return acc;
        }, {});
    return { ...autogeneratedTemporalFields, ...autogeneratedFields };
}
