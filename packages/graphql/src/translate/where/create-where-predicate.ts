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

import type { GraphQLWhereArg, Context, PredicateReturn } from "../../types";
import type { GraphElement } from "../../classes";
import Cypher from "@neo4j/cypher-builder";
// Recursive function

import { createPropertyWhere } from "./property-operations/create-property-where";
import type { ListPredicate } from "./utils";

type WhereOperators = "OR" | "AND";

function isWhereOperator(key: string): key is WhereOperators {
    return ["OR", "AND"].includes(key);
}

/** Translate a target node and GraphQL input into a Cypher operation o valid where expression */
export function createWherePredicate({
    targetElement,
    whereInput,
    context,
    element,
    listPredicateStr,
    topLevelNode,
    topLevelPattern,
}: {
    targetElement: Cypher.Variable;
    whereInput: GraphQLWhereArg;
    context: Context;
    element: GraphElement;
    listPredicateStr?: ListPredicate;
    topLevelNode?: Cypher.Node;
    topLevelPattern?: Cypher.RawCypher;
}): PredicateReturn {
    const whereFields = Object.entries(whereInput);
    const predicates: Cypher.Predicate[] = [];
    const requiredVariables: Cypher.Variable[] = [];
    const aggregatingVariables: Cypher.Variable[] = [];
    let subqueries: Cypher.CompositeClause | undefined;
    whereFields.forEach(([key, value]) => {
        if (isWhereOperator(key)) {
            const {
                predicate,
                preComputedSubqueries,
                requiredVariables: innerRequiredVariables,
                aggregatingVariables: innerAggregatingVariables,
            } = createNestedPredicate({
                key,
                element,
                targetElement,
                topLevelNode,
                topLevelPattern,
                context,
                value,
                listPredicateStr,
                requiredVariables,
            });
            if (predicate) {
                predicates.push(predicate);
                requiredVariables.push(...innerRequiredVariables);
                aggregatingVariables.push(...innerAggregatingVariables);
                if (preComputedSubqueries && !preComputedSubqueries.empty)
                    subqueries = Cypher.concat(subqueries, preComputedSubqueries);
            }
            return;
        }
        const {
            predicate,
            preComputedSubqueries,
            requiredVariables: innerRequiredVariables,
            aggregatingVariables: innerAggregatingVariables,
        } = createPropertyWhere({
            key,
            value,
            element,
            targetElement,
            context,
            listPredicateStr,
            requiredVariables,
            topLevelNode,
            topLevelPattern,
        });
        if (predicate) {
            predicates.push(predicate);
            requiredVariables.push(...innerRequiredVariables);
            aggregatingVariables.push(...innerAggregatingVariables);
            if (preComputedSubqueries && !preComputedSubqueries.empty)
                subqueries = Cypher.concat(subqueries, preComputedSubqueries);
            return;
        }
    });
    // Implicit AND
    return {
        predicate: Cypher.and(...predicates),
        preComputedSubqueries: subqueries,
        requiredVariables,
        aggregatingVariables,
    };
}

function createNestedPredicate({
    key,
    element,
    targetElement,
    context,
    value,
    listPredicateStr,
    requiredVariables,
    topLevelNode,
    topLevelPattern,
}: {
    key: WhereOperators;
    value: Array<GraphQLWhereArg>;
    element: GraphElement;
    targetElement: Cypher.Variable;
    context: Context;
    listPredicateStr?: ListPredicate;
    requiredVariables: Cypher.Variable[];
    topLevelNode?: Cypher.Node;
    topLevelPattern?: Cypher.RawCypher;
}): PredicateReturn {
    const nested: Cypher.Predicate[] = [];
    const aggregatingVariables: Cypher.Variable[] = [];
    let subqueries: Cypher.CompositeClause | undefined;
    value.forEach((v) => {
        const {
            predicate,
            preComputedSubqueries,
            requiredVariables: innerReturnVariables,
            aggregatingVariables: innerAggregatingVariables,
        } = createWherePredicate({
            whereInput: v,
            element,
            targetElement,
            context,
            listPredicateStr,
            topLevelNode,
            topLevelPattern,
        });
        if (predicate) {
            nested.push(predicate);
        }
        requiredVariables.push(...innerReturnVariables);
        aggregatingVariables.push(...innerAggregatingVariables);
        if (preComputedSubqueries && !preComputedSubqueries.empty)
            subqueries = Cypher.concat(subqueries, preComputedSubqueries);
    });
    if (key === "OR") {
        return {
            predicate: Cypher.or(...nested),
            preComputedSubqueries: subqueries,
            requiredVariables,
            aggregatingVariables,
        };
    }
    return {
        predicate: Cypher.and(...nested),
        preComputedSubqueries: subqueries,
        requiredVariables,
        aggregatingVariables,
    };
}
