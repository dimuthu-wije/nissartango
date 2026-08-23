import { defineCollection, z } from 'astro:content';
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

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['cours', 'practica', 'milonga', 'stage', 'demo', 'festival']),
    date: z.coerce.date(),
    endDate: optionalDate,
    location: z.string(),
    city: z.string().default('Nice'),
    organizer: z.string().default('Nissartango'),
    organizerUrl: optionalUrl,
    teachers: z.array(z.string()).default([]),
    price: optionalString,
    signupUrl: optionalUrl,
    image: optionalString,
    title_en: optionalString,
    description_en: optionalString,
  }),
});

export const collections = { events };