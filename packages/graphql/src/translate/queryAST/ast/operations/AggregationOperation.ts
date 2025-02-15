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

import Cypher from "@neo4j/cypher-builder";
import type { ConcreteEntityAdapter } from "../../../../schema-model/entity/model-adapters/ConcreteEntityAdapter";
import { RelationshipAdapter } from "../../../../schema-model/relationship/model-adapters/RelationshipAdapter";
import { filterTruthy } from "../../../../utils/utils";
import { createNodeFromEntity, createRelationshipFromEntity } from "../../utils/create-node-from-entity";
import { wrapSubqueriesInCypherCalls } from "../../utils/wrap-subquery-in-calls";
import { QueryASTContext } from "../QueryASTContext";
import type { QueryASTNode } from "../QueryASTNode";
import type { AggregationField } from "../fields/aggregation-fields/AggregationField";
import type { Filter } from "../filters/Filter";
import type { AuthorizationFilters } from "../filters/authorization-filters/AuthorizationFilters";
import type { Pagination } from "../pagination/Pagination";
import type { Sort } from "../sort/Sort";
import type { OperationTranspileResult } from "./operations";
import { Operation } from "./operations";

// TODO: somewhat dupe of readOperation
export class AggregationOperation extends Operation {
    public readonly entity: ConcreteEntityAdapter | RelationshipAdapter; // TODO: normal entities
    protected directed: boolean;

    public fields: AggregationField[] = []; // Aggregation fields
    public nodeFields: AggregationField[] = []; // Aggregation node fields
    public edgeFields: AggregationField[] = []; // Aggregation node fields

    protected authFilters: AuthorizationFilters[] = [];

    public aggregationProjectionMap = new Cypher.Map();

    protected filters: Filter[] = [];
    protected pagination: Pagination | undefined;
    protected sortFields: Sort[] = [];

    public nodeAlias: string | undefined; // This is just to maintain naming with the old way (this), remove after refactor

    constructor({
        entity,
        directed = true,
    }: {
        entity: ConcreteEntityAdapter | RelationshipAdapter;
        directed?: boolean;
    }) {
        super();
        this.entity = entity;
        this.directed = directed;
    }

    public setFields(fields: AggregationField[]) {
        this.fields = fields;
    }

    public addSort(...sort: Sort[]): void {
        this.sortFields.push(...sort);
    }

    public addPagination(pagination: Pagination): void {
        this.pagination = pagination;
    }

    public addFilters(...filters: Filter[]) {
        this.filters.push(...filters);
    }

    public addAuthFilters(...filter: AuthorizationFilters[]) {
        this.authFilters.push(...filter);
    }

    public getChildren(): QueryASTNode[] {
        return filterTruthy([
            ...this.fields,
            ...this.nodeFields,
            ...this.edgeFields,
            ...this.filters,
            ...this.sortFields,
            ...this.authFilters,
            this.pagination,
        ]);
    }

    public setNodeFields(fields: AggregationField[]) {
        this.nodeFields = fields;
    }

    public setEdgeFields(fields: AggregationField[]) {
        this.edgeFields = fields;
    }

    public transpile(context: QueryASTContext): OperationTranspileResult {
        if (!context.hasTarget()) {
            throw new Error("No parent node found!");
        }
        const clauses = this.transpileAggregation(context);

        const isTopLevel = !(this.entity instanceof RelationshipAdapter);
        if (isTopLevel) {
            const clausesSubqueries = clauses.flatMap((sq) => new Cypher.Call(sq));

            return {
                clauses: clausesSubqueries,
                projectionExpr: this.aggregationProjectionMap,
            };
        } else {
            return {
                clauses,
                projectionExpr: this.aggregationProjectionMap,
            };
        }
    }

    protected getPredicates(queryASTContext: QueryASTContext): Cypher.Predicate | undefined {
        const authPredicates = this.getAuthFilterPredicate(queryASTContext);
        return Cypher.and(...this.filters.map((f) => f.getPredicate(queryASTContext)), ...authPredicates);
    }

    protected getAuthFilterPredicate(context: QueryASTContext): Cypher.Predicate[] {
        return filterTruthy(this.authFilters.map((f) => f.getPredicate(context)));
    }

    protected addSortToClause(
        context: QueryASTContext,
        node: Cypher.Variable,
        clause: Cypher.With | Cypher.Return
    ): void {
        const orderByFields = this.sortFields.flatMap((f) => f.getSortFields(context, node));
        const pagination = this.pagination ? this.pagination.getPagination() : undefined;
        clause.orderBy(...orderByFields);

        if (pagination?.skip) {
            clause.skip(pagination.skip);
        }
        if (pagination?.limit) {
            clause.limit(pagination.limit);
        }
    }

    protected getFieldProjectionClause(
        target: Cypher.Variable,
        returnVariable: Cypher.Variable,
        field: AggregationField
    ): Cypher.Clause {
        return field.getAggregationProjection(target, returnVariable);
    }

    private getPattern(context: QueryASTContext): Cypher.Pattern {
        if (!context.target) {
            throw new Error("Not Target");
        }
        if (context.relationship) {
            if (!context.direction || !context.source) {
                throw new Error("No valid relationship");
            }
            return new Cypher.Pattern(context.source)
                .withoutLabels()
                .related(context.relationship)
                .withDirection(context.direction)
                .to(context.target);
        } else {
            return new Cypher.Pattern(context.target);
        }
    }

    private createContext(parentContext: QueryASTContext) {
        if (this.entity instanceof RelationshipAdapter) {
            const relVar = createRelationshipFromEntity(this.entity);
            const targetNode = createNodeFromEntity(this.entity.target, parentContext.neo4jGraphQLContext);
            const relDirection = this.entity.getCypherDirection(this.directed);
            return parentContext.push({ relationship: relVar, target: targetNode, direction: relDirection });
        } else {
            const targetNode = createNodeFromEntity(this.entity, parentContext.neo4jGraphQLContext, this.nodeAlias);
            return new QueryASTContext({
                target: targetNode,
                neo4jGraphQLContext: parentContext.neo4jGraphQLContext,
            });
        }
    }

    private transpileAggregation(context: QueryASTContext<Cypher.Node>) {
        const operationContext = this.createContext(context);
        const pattern = this.getPattern(operationContext);

        const fieldSubqueries = this.fields.map((f) => {
            const returnVariable = new Cypher.Variable();
            this.aggregationProjectionMap.set(f.getProjectionField(returnVariable));
            return this.createSubquery(f, pattern, operationContext.target, returnVariable, operationContext);
        });

        const nodeMap = new Cypher.Map();
        const nodeFieldSubqueries = this.nodeFields.map((f) => {
            const returnVariable = new Cypher.Variable();
            nodeMap.set(f.getProjectionField(returnVariable));
            return this.createSubquery(f, pattern, operationContext.target, returnVariable, operationContext);
        });

        if (nodeMap.size > 0) {
            this.aggregationProjectionMap.set("node", nodeMap);
        }

        let edgeFieldSubqueries: Cypher.Clause[] = [];
        if (operationContext.relationship) {
            const relVar = operationContext.relationship;
            const edgeMap = new Cypher.Map();
            edgeFieldSubqueries = this.edgeFields.map((f) => {
                const returnVariable = new Cypher.Variable();
                edgeMap.set(f.getProjectionField(returnVariable));
                return this.createSubquery(f, pattern, relVar, returnVariable, operationContext);
            });
            if (edgeMap.size > 0) {
                this.aggregationProjectionMap.set("edge", edgeMap);
            }
        }

        return [...fieldSubqueries, ...nodeFieldSubqueries, ...edgeFieldSubqueries];
    }

    private createSubquery(
        field: AggregationField,
        pattern: Cypher.Pattern,
        target: Cypher.Variable,
        returnVariable: Cypher.Variable,
        context: QueryASTContext
    ): Cypher.Clause {
        const matchClause = new Cypher.Match(pattern);
        let extraSelectionWith: Cypher.With | undefined = undefined;

        const nestedSubqueries = wrapSubqueriesInCypherCalls(context, this.getChildren(), [target]);
        const filterPredicates = this.getPredicates(context);

        const selectionClauses = this.getChildren().flatMap((c) => {
            return c.getSelection(context);
        });
        if (selectionClauses.length > 0 || nestedSubqueries.length > 0) {
            extraSelectionWith = new Cypher.With("*");
        }

        if (filterPredicates) {
            if (extraSelectionWith) {
                extraSelectionWith.where(filterPredicates);
            } else {
                matchClause.where(filterPredicates);
            }
        }
        const ret = this.getFieldProjectionClause(target, returnVariable, field);

        let sortClause: Cypher.With | undefined;
        if (this.sortFields.length > 0 || this.pagination) {
            sortClause = new Cypher.With("*");
            this.addSortToClause(context, target, sortClause);
        }

        return Cypher.concat(
            matchClause,
            ...selectionClauses,
            ...nestedSubqueries,
            extraSelectionWith,
            sortClause,
            ret
        );
    }
}
