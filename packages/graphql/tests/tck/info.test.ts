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
import type { DocumentNode } from "graphql";
import { Neo4jGraphQL } from "../../src";
import { formatCypher, translateQuery, formatParams } from "./utils/tck-test-utils";

describe("info", () => {
    let typeDefs: DocumentNode;
    let neoSchema: Neo4jGraphQL;

    beforeAll(() => {
        typeDefs = gql`
            type Actor {
                name: String!
            }

            type Movie {
                id: ID
                title: String!
                actors: [Actor!]! @relationship(type: "ACTED_IN", direction: IN)
            }
        `;

        neoSchema = new Neo4jGraphQL({
            typeDefs,
        });
    });

    test("should return info from a create mutation", async () => {
        const query = gql`
            mutation {
                createMovies(input: [{ title: "title", actors: { create: [{ node: { name: "Keanu" } }] } }]) {
                    info {
                        bookmark
                        nodesCreated
                        relationshipsCreated
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "UNWIND $create_param0 AS create_var0
            CALL {
                WITH create_var0
                CREATE (create_this1:Movie)
                SET
                    create_this1.title = create_var0.title
                WITH create_this1, create_var0
                CALL {
                    WITH create_this1, create_var0
                    UNWIND create_var0.actors.create AS create_var2
                    WITH create_var2.node AS create_var3, create_var2.edge AS create_var4, create_this1
                    CREATE (create_this5:Actor)
                    SET
                        create_this5.name = create_var3.name
                    MERGE (create_this1)<-[create_this6:ACTED_IN]-(create_this5)
                    RETURN collect(NULL) AS create_var7
                }
                RETURN create_this1
            }
            RETURN \\"Query cannot conclude with CALL\\""
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"create_param0\\": [
                    {
                        \\"title\\": \\"title\\",
                        \\"actors\\": {
                            \\"create\\": [
                                {
                                    \\"node\\": {
                                        \\"name\\": \\"Keanu\\"
                                    }
                                }
                            ]
                        }
                    }
                ],
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });

    test("should return info from a delete mutation", async () => {
        const query = gql`
            mutation {
                deleteMovies(where: { id: "123" }) {
                    bookmark
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:Movie)
            WHERE this.id = $param0
            DETACH DELETE this"
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"123\\"
            }"
        `);
    });

    test("should return info from an update mutation", async () => {
        const query = gql`
            mutation {
                updateMovies(where: { id: "123" }) {
                    info {
                        bookmark
                    }
                }
            }
        `;

        const result = await translateQuery(neoSchema, query);

        expect(formatCypher(result.cypher)).toMatchInlineSnapshot(`
            "MATCH (this:Movie)
            WHERE this.id = $param0
            RETURN \\"Query cannot conclude with CALL\\""
        `);

        expect(formatParams(result.params)).toMatchInlineSnapshot(`
            "{
                \\"param0\\": \\"123\\",
                \\"resolvedCallbacks\\": {}
            }"
        `);
    });
});
