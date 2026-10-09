/**
 * SPIKE — adds a "Learning widgets" collection to the demo teacher
 * (demo@eduskript.org, created by scripts/seed-demo.mjs): one skript with a
 * Kara page and a quiz page, the same widgets as the stand-alone demo
 * (standalone/demo, standalone/dokuwiki). Here they run natively in Eduskript
 * (in-page adapter), for comparison. Idempotent: does nothing if the skript
 * exists.
 *
 * Run inside the app container (needs the app's node_modules):
 *   docker cp seed-widgets-demo.mjs eduskript-demo:/app/scripts/
 *   docker exec -w /app eduskript-demo node scripts/seed-widgets-demo.mjs
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'

const DEMO_EMAIL = 'demo@eduskript.org'
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

async function main() {
  const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })
  if (!user) throw new Error(`${DEMO_EMAIL} not found: run scripts/seed-demo.mjs first`)
  if (await prisma.skript.findFirst({ where: { slug: SKRIPT_SLUG } })) {
    console.log('Learning widgets skript already exists')
    return
  }

  const collection = await prisma.collection.create({
    data: {
      title: 'Learning widgets',
      slug: 'learning-widgets',
      description: 'Kara and quiz questions, natively in Eduskript',
      authors: { create: { userId: user.id, permission: 'author' } },
    },
  })
  const skript = await prisma.skript.create({
    data: {
      title: 'Learning widgets',
      slug: SKRIPT_SLUG,
      isPublished: true,
      authors: { create: { userId: user.id, permission: 'author' } },
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
        authors: { create: { userId: user.id, permission: 'author' } },
      },
    })
  }

  // Show the collection first on the demo teacher's front page. Layouts hang
  // off the user's Site (PageLayout.siteId), not the user.
  const site = await prisma.site.findFirst({ where: { userId: user.id } })
  if (site) {
    const layout = await prisma.pageLayout.upsert({ where: { siteId: site.id }, create: { siteId: site.id }, update: {} })
    await prisma.pageLayoutItem.updateMany({ where: { pageLayoutId: layout.id }, data: { order: { increment: 1 } } })
    await prisma.pageLayoutItem.create({ data: { pageLayoutId: layout.id, type: 'collection', contentId: collection.id, order: 0 } })
  }
  console.log(`Created collection "${collection.title}" with ${pages.length} pages`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect(); await pool.end() })
