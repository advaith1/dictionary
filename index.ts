import { Client, InteractionReplyOptions, MessageActionRowOptions } from 'discord.js'
import { request } from 'undici'

import type { Entry } from 'mw-collegiate'

import { mwKey, discordToken } from './config.json'

const client = new Client({ intents: [] })

console.log('starting')

client.on('ready', () => console.log(`started! ${client.user.tag}`))

/** Trim text to a character limit, with ellipses if needed */
const trim = (text: string, max: number) => text.length > max ? text.substring(0, max - 1)+'…' : text

const cache: {[word: string]: Entry[]} = {}
const autocompleteCache: {[word: string]: string[]} = {}

/** Get the dictionary result for a word (from cache if available) */
const lookup = async (word: string) => {
	if (cache[word]) return cache[word]

	const result = await (await request(`https://dictionaryapi.com/api/v3/references/collegiate/json/${word}?key=${mwKey}`)).body.json() as Entry[]

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
	{
		type: 'ACTION_ROW',
		components: [
			{
				type: 'BUTTON',
				style: 'PRIMARY',
				label: 1,
				customId: `${word}:0:first`,
				disabled: page === 0
			},
			{
				type: 'BUTTON',
				style: 'PRIMARY',
				label: result[page - 1] ? `Previous (${page})` : 'Previous',
				customId: `${word}:${page - 1}:prev`,
				disabled: !result[page - 1]
			},
			{
				type: 'BUTTON',
				style: 'PRIMARY',
				label: result[page + 1] ? `Next (${page + 2})` : 'Next',
				customId: `${word}:${page + 1}:next`,
				disabled: !result[page + 1]
			},
			{
				type: 'BUTTON',
				style: 'PRIMARY',
				label: result.length,
				customId: `${word}:${result.length - 1}:last`,
				disabled: page === result.length - 1
			}
		],
	},
	{
		type: 'ACTION_ROW',
		components: [
			{
				type: 'SELECT_MENU',
				customId: 'select',
				placeholder: 'Choose a definition',
				options: result.map((d, i) => ({
					label: trim(`${i + 1}. ${d.hwi.hw.replace(/\*/g, '')}${d.fl ? ` (${d.fl})` : ''}`, 100),
					// definition, falls back to cross-reference
					description: trim(d.shortdef.join(', ') || d.cxs && `${d.cxs[0].cxl} ${d.cxs[0].cxtis[0].cxt}`, 100),
					value: `${word}:${i}`,
					default: i === page
				}))
			}
		]
	}
] as MessageActionRowOptions[]

client.on('interactionCreate', async interaction => {
	if (interaction.isCommand()) {
		const query = interaction.options.getString('term')
		if (!query) return interaction.reply({ content: "You didn't enter a term.", ephemeral: true })

		interaction.reply(await generateMessage(interaction.options.getString('term'), 0))
	}

	if (interaction.isMessageComponent()) {
		const [word, page] = (interaction.isSelectMenu() ? interaction.values[0] : interaction.customId).split(':')

		interaction.update(await generateMessage(word, parseInt(page)))
	}

	if (interaction.isAutocomplete()) {
		const query = interaction.options.getString('term')

		if (!query) {
			const results = (await (await request('https://www.merriam-webster.com/lapi/v1/mwol-mp/get-lookups-data-homepage')).body.json()).data.words

			interaction.respond([
				{ name: 'Type your query, or select a current top Merriam-Webster lookup:', value: '' },
				...results.slice(0, 24).map(r => ({ name: r, value: r }))
			])

		} else {
			if (!autocompleteCache[query]) {
				const results = (await (await request(`https://www.merriam-webster.com/lapi/v1/mwol-search/autocomplete?search=${query}`)).body.json()).docs
				autocompleteCache[query] = results.filter(r => r.ref === 'owl-combined').map(r => r.word).slice(0, 25)
				// filters to dictionary (owl-combined) to remove thesaurus results
			}

			interaction.respond(autocompleteCache[query].map(w => ({ name: w, value: w })))
		}
	}
})

client.login(discordToken)
