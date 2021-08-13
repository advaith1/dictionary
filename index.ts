import { Client, InteractionReplyOptions, MessageActionRowComponentOptions } from 'discord.js'
import fetch from 'node-fetch'

import type { Entry } from 'mw-collegiate'

import { mwKey, discordToken } from './config.json'

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
	} as InteractionReplyOptions
}

/** Generate the message components to send (button and selects) */
const generateComponents = (word: string, page: number, result: Entry[]) => [
	[
		{
			type: 'BUTTON',
			style: 'PRIMARY',
			label: 1,
			customID: `${word}:0:first`,
			disabled: page === 0
		},
		{
			type: 'BUTTON',
			style: 'PRIMARY',
			label: result[page - 1] ? `Previous (${page})` : 'Previous',
			customID: `${word}:${page - 1}:prev`,
			disabled: !result[page - 1]
		},
		{
			type: 'BUTTON',
			style: 'PRIMARY',
			label: result[page + 1] ? `Next (${page + 2})` : 'Next',
			customID: `${word}:${page + 1}:next`,
			disabled: !result[page + 1]
		},
		{
			type: 'BUTTON',
			style: 'PRIMARY',
			label: result.length,
			customID: `${word}:${result.length - 1}:last`,
			disabled: page === result.length - 1
		}
	],
	[
		{
			type: 'SELECT_MENU',
			customID: 'select',
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
] as MessageActionRowComponentOptions[][]

client.on('interaction', async interaction => {
	if (interaction.isCommand())
		interaction.reply(await generateMessage(interaction.options.get('term').value as string, 0))

	if (interaction.isMessageComponent()) {
		const [word, page] = (interaction.isSelectMenu() ? interaction.values[0] : interaction.customID).split(':')

		interaction.update(await generateMessage(word, parseInt(page)))
	}

})

client.login(discordToken)
