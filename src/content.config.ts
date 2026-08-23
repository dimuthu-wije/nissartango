import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    type: z.enum(['cours', 'practica', 'milonga', 'stage', 'demo', 'festival']),
    date: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    location: z.string(),
    city: z.string().default('Nice'),
    organizer: z.string().default('Nissa Tango'),
    organizerUrl: z.string().url().optional(),
    teachers: z.array(z.string()).default([]),
    price: z.string().optional(),
    signupUrl: z.string().url().optional(),
    image: z.string().optional(),
    title_en: z.string().optional(),
    description_en: z.string().optional(),
  }),
});

export const collections = { events };