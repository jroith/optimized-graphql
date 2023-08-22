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

import type {
    ASTVisitor,
    DirectiveNode,
    ObjectTypeDefinitionNode,
    FieldDefinitionNode,
    InterfaceTypeDefinitionNode,
} from "graphql";
import { Kind } from "graphql";
import type { SDLValidationContext } from "graphql/validation/ValidationContext";
import { RESERVED_INTERFACE_FIELDS } from "../../../../constants";
import { assertValid, createGraphQLError, DocumentValidationError } from "../utils/document-validation-error";
import { getPathToNode } from "../utils/path-parser";

export function ValidRelationshipProperties(context: SDLValidationContext): ASTVisitor {
    return {
        Directive(directiveNode: DirectiveNode, _key, _parent, path, ancestors) {
            if (directiveNode.name.value !== "relationshipProperties") {
                return;
            }

            const [pathToNode, traversedDef] = getPathToNode(path, ancestors);
            if (!traversedDef) {
                console.error("No last definition traversed");
                return;
            }

            const { isValid, errorMsg, errorPath } = assertValid(() => assertRelationshipProperties(traversedDef));
            if (!isValid) {
                context.reportError(
                    createGraphQLError({
                        nodes: [directiveNode, traversedDef],
                        path: [...pathToNode, ...errorPath],
                        errorMsg,
                    })
                );
            }
        },
    };
}

function assertRelationshipProperties(
    traversedDef: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode | FieldDefinitionNode
) {
    if (traversedDef.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
        // delegate
        return;
    }
    traversedDef.fields?.forEach((field) => {
        const errorPath = [field.name.value];
        RESERVED_INTERFACE_FIELDS.forEach(([fieldName, message]) => {
            if (field.name.value === fieldName) {
                throw new DocumentValidationError(`Invalid @relationshipProperties field: ${message}`, errorPath);
            }
        });

        if (field.directives) {
            const forbiddenDirectives = [
                "authorization",
                "authentication",
                "subscriptionsAuthorization",
                "relationship",
                "cypher",
            ];
            const foundForbiddenDirective = field.directives.find((d) => forbiddenDirectives.includes(d.name.value));
            if (foundForbiddenDirective) {
                throw new DocumentValidationError(
                    `Invalid @relationshipProperties field: Cannot use the @${foundForbiddenDirective.name.value} directive on relationship properties.`,
                    errorPath
                );
            }
        }
    });
}
