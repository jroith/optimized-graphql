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

import { gql } from "graphql-tag";
import { GraphQLError, GraphQLSchema } from "graphql";
import { Neo4jGraphQL } from "../../../src";

describe("schema/rfc/003", () => {
    const msg = `Invalid field type: List type relationship fields must be non-nullable and have non-nullable entries, please change type to [Target!]!`;

    describe("ObjectType", () => {
        test("should not throw when using valid relationship", async () => {
            const typeDefs = gql`
                type Source {
                    targets: [Target!]! @relationship(type: "HAS_TARGET", direction: OUT)
                    target1: SecondTarget! @relationship(type: "HAS_TARGET", direction: OUT)
                    target2: ThirdTarget @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Target {
                    id: ID @id @unique
                }

                type SecondTarget {
                    id: ID @id @unique
                }

                type ThirdTarget {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).resolves.toBeInstanceOf(GraphQLSchema);
        });

        test("If there are no relationships, then should always be empty array and not null", async () => {
            const typeDefs = gql`
                type Source {
                    targets: [Target!] @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).rejects.toIncludeSameMembers([new GraphQLError(msg)]);
        });

        test("This suggests a relationship with no target node", async () => {
            const typeDefs = gql`
                type Source {
                    targets: [Target]! @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });
            await expect(neoSchema.getSchema()).rejects.toIncludeSameMembers([new GraphQLError(msg)]);
        });

        test("should throw when ListType and not NonNullNamedType inside it", async () => {
            const typeDefs = gql`
                type Source {
                    targets: [Target] @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).rejects.toIncludeSameMembers([new GraphQLError(msg)]);
        });
    });

    describe("InterfaceType", () => {
        test("should not throw when using valid relationship", async () => {
            const typeDefs = gql`
                interface SourceInterface {
                    targets: [Target!]! @relationship(type: "HAS_TARGET", direction: OUT)
                    target1: Target! @relationship(type: "HAS_TARGET", direction: OUT)
                    target2: Target @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Source implements SourceInterface {
                    id: ID @id @unique
                    targets: [Target!]!
                    target1: Target!
                    target2: Target
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).resolves.toBeInstanceOf(GraphQLSchema);
        });

        test("If there are no relationships, then should always be empty array and not null", async () => {
            const typeDefs = gql`
                interface SourceInterface {
                    targets: [Target!] @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Source implements SourceInterface {
                    id: ID @id @unique
                    targets: [Target!]
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).rejects.toIncludeSameMembers([new GraphQLError(msg)]);
        });

        test("This suggests a relationship with no target node", async () => {
            const typeDefs = gql`
                interface SourceInterface {
                    targets: [Target]! @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Source implements SourceInterface {
                    id: ID @id @unique
                    targets: [Target]!
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).rejects.toIncludeSameMembers([new GraphQLError(msg)]);
        });

        test("should throw when ListType and not NonNullNamedType inside it", async () => {
            const typeDefs = gql`
                interface SourceInterface {
                    targets: [Target] @relationship(type: "HAS_TARGET", direction: OUT)
                }

                type Source implements SourceInterface {
                    id: ID @id @unique
                    targets: [Target]
                }

                type Target {
                    id: ID @id @unique
                }
            `;

            const neoSchema = new Neo4jGraphQL({ typeDefs });

            await expect(neoSchema.getSchema()).rejects.toIncludeSameMembers([new GraphQLError(msg)]);
        });
    });
});
