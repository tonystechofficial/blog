import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string().max(90),
		description: z.string().max(200),
		// The day the work happened. Posts are dated by the work, not by the publication.
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		track: z.enum(['ai-engineering', 'minima', 'onchain', 'infrastructure']),
		tags: z.array(z.string()).default([]),
		// Working notes the post was written from (not rendered).
		sources: z.array(z.string()).optional(),
		draft: z.boolean().default(false),
	}),
});

export const collections = { blog };
