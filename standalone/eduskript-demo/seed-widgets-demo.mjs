/**
 * SPIKE — demo content for the bottom.ch instance: a teacher account with its
 * own site (OWNER_EMAIL, site slug OWNER_SITE) holding a "Learning widgets"
 * collection: one skript with a Kara page and a quiz page, the same widgets as
 * the stand-alone demo (standalone/demo, standalone/dokuwiki), here running
 * natively in Eduskript (in-page adapter) for comparison.
 *
 * Also locks demo@eduskript.org (created by scripts/seed-demo.mjs with the
 * public password "demodemo") by giving it a random password.
 *
 * Idempotent: an existing owner or skript is left alone. The owner's password
 * is only set on creation and printed once, to stdout.
 *
 * Run inside the app container (needs the app's node_modules):
 *   docker cp seed-widgets-demo.mjs eduskript-demo:/app/scripts/
 *   docker exec -w /app -e OWNER_EMAIL=… eduskript-demo node scripts/seed-widgets-demo.mjs
 *
 * Schema notes (2026-10): a Collection belongs to a Site (no slug, no author
 * table; editing rights come from owning the site); PageLayout hangs off the
 * Site. scripts/seed-demo.mjs predates both and fails on a fresh database.
 */

import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'tom@scheidweg.net'
const OWNER_NAME = process.env.OWNER_NAME || 'Tom Hofmann'
const OWNER_SITE = process.env.OWNER_SITE || 'tom'
const SKRIPT_SLUG = 'learning-widgets'

const KARA = `# Kara

Both levels count towards the same skript-wide progress. A solution for the first level:

\`\`\`python
while not wall_front():
    if on_barrel():
        remove_barrel()
    move()
turn_left()
move()
\`\`\`

## Level 1: corridor

\`\`\`python editor id="kara-corridor"
# Your program
\`\`\`

\`\`\`kara-world for="kara-corridor"
######E#
#>..*..#
########
===
######E#
#>.*.*.#
########
---
id: corridor
goal: exit, collect
energy: 20
\`\`\`

## Level 2: boxes

\`\`\`python editor id="kara-boxes"
# Your program
\`\`\`

\`\`\`kara-world for="kara-boxes"
#######
#>.B.o#
#######
---
id: push
goal: boxes
intro: Push the box onto the target. | speaker=AURORA
\`\`\`
`

const QUIZ = `# Quiz

<question id="q-immutable" type="multiple" feedback="check" attempts="2" points="2">
Which of these are **immutable** in Python?
<answer correct="true" feedback="Yes: a tuple cannot change after creation.">tuple</answer>
<answer correct="false" feedback="Lists change in place.">list</answer>
<answer correct="true" feedback="Yes: string methods return new strings.">str</answer>
<answer correct="false" feedback="Dicts are mutable.">dict</answer>
</question>

<question id="q-output" type="text" expected="[1, 2, 3, 4]" points="1">
What does \`a = [1, 2]; b = a; b += [3, 4]; print(a)\` print?
</question>
`

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })
const randomPassword = () => crypto.randomBytes(18).toString('base64url')

async function ensureOwner() {
  const existing = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })
  if (existing) {
    console.log(`Owner ${OWNER_EMAIL} already exists (password unchanged)`)
    return existing
  }
  const password = randomPassword()
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: OWNER_EMAIL,
        name: OWNER_NAME,
        accountType: 'teacher',
        hashedPassword: await bcrypt.hash(password, 12),
        emailVerified: new Date(),
        billingPlan: 'pro',
      },
    })
    await tx.site.create({ data: { slug: OWNER_SITE, userId: u.id, pageName: OWNER_NAME } })
    return u
  })
  console.log(`OWNER_LOGIN ${OWNER_EMAIL} ${password}`)
  return user
}

async function lockDemoTeacher() {
  const demo = await prisma.user.findUnique({ where: { email: 'demo@eduskript.org' } })
  if (!demo || !(await bcrypt.compare('demodemo', demo.hashedPassword ?? ''))) return
  await prisma.user.update({ where: { id: demo.id }, data: { hashedPassword: await bcrypt.hash(randomPassword(), 12) } })
  console.log('Locked demo@eduskript.org (public password replaced)')
}

async function main() {
  await lockDemoTeacher()
  const owner = await ensureOwner()
  const site = await prisma.site.findFirst({ where: { userId: owner.id } })
  if (!site) throw new Error(`${OWNER_EMAIL} has no site`)
  if (await prisma.skript.findFirst({ where: { slug: SKRIPT_SLUG, authors: { some: { userId: owner.id } } } })) {
    console.log('Learning widgets skript already exists')
    return
  }

  const collection = await prisma.collection.create({ data: { siteId: site.id, title: 'Learning widgets' } })
  const skript = await prisma.skript.create({
    data: {
      title: 'Learning widgets',
      slug: SKRIPT_SLUG,
      description: 'Kara and quiz questions, natively in Eduskript',
      isPublished: true,
      authors: { create: { userId: owner.id, permission: 'author' } },
    },
  })
  await prisma.collectionSkript.create({ data: { collectionId: collection.id, skriptId: skript.id, order: 0 } })

  const pages = [
    { title: 'Kara', slug: 'kara', content: KARA },
    { title: 'Quiz', slug: 'quiz', content: QUIZ },
  ]
  for (const [order, p] of pages.entries()) {
    await prisma.page.create({
      data: {
        ...p,
        order,
        isPublished: true,
        skriptId: skript.id,
        authors: { create: { userId: owner.id, permission: 'author' } },
      },
    })
  }

  const layout = await prisma.pageLayout.upsert({ where: { siteId: site.id }, create: { siteId: site.id }, update: {} })
  await prisma.pageLayoutItem.create({ data: { pageLayoutId: layout.id, type: 'collection', contentId: collection.id, order: 0 } })
  console.log(`Created "${collection.title}" on site /${site.slug} with ${pages.length} pages`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })
