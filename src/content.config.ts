import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

const optionalUrl = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().url().optional()
);

const optionalString = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().optional()
);

const optionalDate = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.coerce.date().optional()
);

const organizers = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/organizers' }),
  schema: z.object({
    name: z.string(),
    website: optionalUrl,
    instagram: optionalString,
    facebook: optionalString,
    tiktok: optionalString,
    email: optionalString,
    phone: optionalString,
  }),
});

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['cours', 'practica', 'milonga', 'stage', 'demo', 'festival']),
    date: z.coerce.date(),
    endDate: optionalDate,
    recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']).default('none'),
    recurrenceEnd: optionalDate,
    exceptions: z.array(z.coerce.date()).default([]),
    location: z.string(),
    city: z.string().default('Nice'),
    organizer: reference('organizers'),
    teachers: z.array(z.string()).default([]),
    price: optionalString,
    signupUrl: optionalUrl,
    image: optionalString,
  }),
});

export const collections = { events, organizers };