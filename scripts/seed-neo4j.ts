/**
 * Neo4j Seed Script
 *
 * Sets up constraints, indexes, and optionally seeds sample data
 * for the Kue professional network graph.
 *
 * Usage:
 *   npx ts-node scripts/seed-neo4j.ts
 *   npx ts-node scripts/seed-neo4j.ts --with-sample-data
 */

import neo4j, { Driver } from 'neo4j-driver';
import * as dotenv from 'dotenv';

dotenv.config();

const NEO4J_URI = process.env.NEO4J_URI || 'neo4j://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password';

async function createConstraintsAndIndexes(driver: Driver) {
  const session = driver.session();
  try {
    console.log('Creating constraints...');

    // Unique constraints
    await session.run(`
      CREATE CONSTRAINT person_id IF NOT EXISTS
      FOR (p:Person) REQUIRE p.id IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT company_id IF NOT EXISTS
      FOR (c:Company) REQUIRE c.id IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT kue_user_id IF NOT EXISTS
      FOR (u:KueUser) REQUIRE u.id IS UNIQUE
    `);

    await session.run(`
      CREATE CONSTRAINT company_domain IF NOT EXISTS
      FOR (c:Company) REQUIRE c.domain IS UNIQUE
    `);

    console.log('Creating indexes...');

    // Full-text search indexes
    await session.run(`
      CREATE FULLTEXT INDEX person_search IF NOT EXISTS
      FOR (p:Person) ON EACH [p.name, p.email, p.title, p.company]
    `);

    await session.run(`
      CREATE FULLTEXT INDEX company_search IF NOT EXISTS
      FOR (c:Company) ON EACH [c.name, c.domain, c.industry]
    `);

    // Property indexes for common lookups
    await session.run(`
      CREATE INDEX person_email IF NOT EXISTS
      FOR (p:Person) ON (p.email)
    `);

    await session.run(`
      CREATE INDEX person_company IF NOT EXISTS
      FOR (p:Person) ON (p.company)
    `);

    await session.run(`
      CREATE INDEX person_owner IF NOT EXISTS
      FOR (p:Person) ON (p.ownerId)
    `);

    await session.run(`
      CREATE INDEX company_name IF NOT EXISTS
      FOR (c:Company) ON (c.name)
    `);

    console.log('Constraints and indexes created successfully.');
  } finally {
    await session.close();
  }
}

async function seedSampleData(driver: Driver) {
  const session = driver.session();
  try {
    console.log('Seeding sample data...');

    // Create a sample KueUser
    await session.run(`
      MERGE (u:KueUser {id: 'sample-user-001'})
      SET u.email = 'demo@kue.app',
          u.name = 'Demo User',
          u.createdAt = datetime()
    `);

    // Create sample Person nodes
    const people = [
      {
        id: 'person-001',
        name: 'Alice Chen',
        email: 'alice@techcorp.com',
        title: 'VP of Engineering',
        company: 'TechCorp',
        location: 'San Francisco, CA',
        source: 'gmail',
      },
      {
        id: 'person-002',
        name: 'Bob Martinez',
        email: 'bob@startupinc.io',
        title: 'CEO',
        company: 'StartupInc',
        location: 'New York, NY',
        source: 'linkedin',
      },
      {
        id: 'person-003',
        name: 'Carol Johnson',
        email: 'carol@designstudio.co',
        title: 'Lead Designer',
        company: 'DesignStudio',
        location: 'Austin, TX',
        source: 'google_contacts',
      },
      {
        id: 'person-004',
        name: 'David Kim',
        email: 'david.kim@bigfin.com',
        title: 'Partner',
        company: 'BigFin Capital',
        location: 'San Francisco, CA',
        source: 'gmail',
      },
      {
        id: 'person-005',
        name: 'Eva Patel',
        email: 'eva@techcorp.com',
        title: 'Product Manager',
        company: 'TechCorp',
        location: 'San Francisco, CA',
        source: 'calendar',
      },
    ];

    for (const person of people) {
      await session.run(
        `
        MERGE (p:Person {id: $id})
        SET p.name = $name,
            p.email = $email,
            p.title = $title,
            p.company = $company,
            p.location = $location,
            p.source = $source,
            p.ownerId = 'sample-user-001',
            p.relationshipScore = toFloat($score),
            p.lastInteraction = datetime(),
            p.createdAt = datetime()
      `,
        { ...person, score: Math.random() * 100 },
      );
    }

    // Create sample Company nodes
    const companies = [
      {
        id: 'company-001',
        name: 'TechCorp',
        domain: 'techcorp.com',
        industry: 'Technology',
        size: '1000-5000',
      },
      {
        id: 'company-002',
        name: 'StartupInc',
        domain: 'startupinc.io',
        industry: 'SaaS',
        size: '10-50',
      },
      {
        id: 'company-003',
        name: 'DesignStudio',
        domain: 'designstudio.co',
        industry: 'Design',
        size: '50-200',
      },
      {
        id: 'company-004',
        name: 'BigFin Capital',
        domain: 'bigfin.com',
        industry: 'Finance',
        size: '200-1000',
      },
    ];

    for (const company of companies) {
      await session.run(
        `
        MERGE (c:Company {id: $id})
        SET c.name = $name,
            c.domain = $domain,
            c.industry = $industry,
            c.size = $size,
            c.createdAt = datetime()
      `,
        company,
      );
    }

    // Create relationships: Person -> WORKS_AT -> Company
    const worksAt = [
      { personId: 'person-001', companyId: 'company-001' },
      { personId: 'person-002', companyId: 'company-002' },
      { personId: 'person-003', companyId: 'company-003' },
      { personId: 'person-004', companyId: 'company-004' },
      { personId: 'person-005', companyId: 'company-001' },
    ];

    for (const rel of worksAt) {
      await session.run(
        `
        MATCH (p:Person {id: $personId}), (c:Company {id: $companyId})
        MERGE (p)-[:WORKS_AT {since: datetime()}]->(c)
      `,
        rel,
      );
    }

    // Create relationships: KueUser -> KNOWS -> Person
    for (const person of people) {
      await session.run(
        `
        MATCH (u:KueUser {id: 'sample-user-001'}), (p:Person {id: $personId})
        MERGE (u)-[:KNOWS {
          strength: toFloat($strength),
          source: $source,
          firstContact: datetime(),
          lastContact: datetime(),
          interactionCount: toInteger($interactions)
        }]->(p)
      `,
        {
          personId: person.id,
          strength: Math.random() * 100,
          source: person.source,
          interactions: Math.floor(Math.random() * 50) + 1,
        },
      );
    }

    // Create inter-person relationships
    await session.run(`
      MATCH (a:Person {id: 'person-001'}), (e:Person {id: 'person-005'})
      MERGE (a)-[:COLLEAGUES_WITH {company: 'TechCorp', since: datetime()}]->(e)
    `);

    await session.run(`
      MATCH (b:Person {id: 'person-002'}), (d:Person {id: 'person-004'})
      MERGE (b)-[:INVESTED_BY {round: 'Series A', since: datetime()}]->(d)
    `);

    console.log('Sample data seeded successfully.');
    console.log(`  - ${people.length} Person nodes`);
    console.log(`  - ${companies.length} Company nodes`);
    console.log(`  - 1 KueUser node`);
    console.log(`  - ${worksAt.length} WORKS_AT relationships`);
    console.log(`  - ${people.length} KNOWS relationships`);
    console.log(`  - 2 inter-person relationships`);
  } finally {
    await session.close();
  }
}

async function main() {
  const withSampleData = process.argv.includes('--with-sample-data');

  console.log(`Connecting to Neo4j at ${NEO4J_URI}...`);
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
  );

  try {
    await driver.verifyConnectivity();
    console.log('Connected to Neo4j successfully.\n');

    await createConstraintsAndIndexes(driver);

    if (withSampleData) {
      console.log('');
      await seedSampleData(driver);
    } else {
      console.log(
        '\nSkipping sample data. Use --with-sample-data flag to seed sample data.',
      );
    }

    console.log('\nDone!');
  } catch (error) {
    console.error('Failed to seed Neo4j:', error);
    process.exit(1);
  } finally {
    await driver.close();
  }
}

main();
