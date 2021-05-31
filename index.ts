import Discord from 'discord.js'
import fetch from 'node-fetch'

import type { Entry } from 'mw-collegiate'
import type { APIInteractionApplicationCommandCallbackData } from 'discord-api-types'

import { mwKey, discordToken } from './config.json'

// override typings to access private method
// @ts-expect-error
class Client extends Discord.Client {
    readonly api: {
        interactions(id: string, token: string): {
            callback: {
				post: ({data}) => void
			}
        }
    }
}

const client = new Client({ intents: [] })

console.log('starting')

client.on('ready', () => console.log(`started! ${client.user.tag}`))

/** Trim text to a character limit, with ellipses if needed */
const trim = (text: string, max: number) => text.length > max ? text.substring(0, max - 1)+'…' : text

const cache: {[word: string]: Entry[]} = {}

/** Get the dictionary result for a word (from cache if available) */
const lookup = async (word: string) => {
	if (cache[word]) return cache[word]

	const r = await fetch(`https://dictionaryapi.com/api/v3/references/collegiate/json/${word}?key=${mwKey}`)
	const result = await r.json() as Entry[]

	cache[word] = result

	return result
}

/** Generate the message to send */
const generateMessage = async (word: string, page: number) => {
	const result = await lookup(word)

	const entry = result[page]

	if (!entry?.hwi) return { content: 'Not found' }
	
	return {
		embeds: [{
			title: `${entry.hwi.hw.replace(/\*/g, '·')}${entry.fl ? ` (${entry.fl})` : ''}`,
			url: `https://www.merriam-webster.com/dictionary/${encodeURIComponent(entry.hwi.hw.replace(/\*/g, ''))}`,
			// definition, falls back to cross-reference
			description: entry.shortdef.map(s => `• ${s}`).join('\n') || entry.cxs && `${entry.cxs[0].cxl} ${entry.cxs[0].cxtis[0].cxt}`,
			footer: {
				text: 'Powered by Merriam-Webster'
			}
		}],
		components: generateComponents(word, page, result)
	} as APIInteractionApplicationCommandCallbackData
}

/** Generate the message components to send (button and selects) */
const generateComponents = (word: string, page: number, result: Entry[]) => [
	{
		type: 1,
		// buttons
		components: [
			{
				type: 2,
				style: 1,
				label: `1`,
				custom_id: `${word}:0`,
				disabled: page === 0
			},
			{
				type: 2,
				style: 1,
				label: result[page - 1] ? `Previous (${page})` : 'Previous',
				custom_id: `${word}:${page - 1}`,
				disabled: !result[page - 1]
			},
			{
				type: 2,
				style: 1,
				label: result[page + 1] ? `Next (${page + 2})` : 'Next',
				custom_id: `${word}:${page + 1}`,
				disabled: !result[page + 1]
			},
			{
				type: 2,
				style: 1,
				label: result.length,
				custom_id: `${word}:${result.length - 1}`,
				disabled: page === result.length - 1
			}
		]
	},
	{
		type: 1,
		components: [
			{
				type: 3,
				custom_id: 'select',
				placeholder: 'Choose a definition',
				options: result.map((d, i) => ({
					label: trim(`${i + 1}. ${d.hwi.hw.replace(/\*/g, '')}${d.fl ? ` (${d.fl})` : ''}`, 25),
					// definition, falls back to cross-reference
					description: trim(d.shortdef.join(', ') || d.cxs && `${d.cxs[0].cxl} ${d.cxs[0].cxtis[0].cxt}`, 50),
					value: `${word}:${i}`,
					default: i === page
				}))
			}
		]
	}
]

// handle command uses
client.on('interaction', async interaction => {
	if (!interaction.isCommand()) return

	client.api.interactions(interaction.id, interaction.token).callback.post({data: {
		type: 4,
		data: await generateMessage(interaction.options[0].value as string, 0)
	}})

})

// handle component (button/select) uses
client.ws.on('INTERACTION_CREATE', async interaction => {
	if (interaction.type !== 3) return

	const [word, page] = ((interaction.data.component_type === 3 ? interaction.data.values[0] : interaction.data.custom_id) as string).split(':')

	await client.api.interactions(interaction.id, interaction.token).callback.post({data: {
		type: 7,
		data: await generateMessage(word, parseInt(page))
	}})
})

client.login(discordToken)
