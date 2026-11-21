package com.hsevents.core;

/**
 * One spelling for a drop's name, so "Dharok's helm" on a tile and the item the
 * game hands out compare equal. The twin of drop_key() in
 * server/001_plugin_tokens.sql; the two must never disagree, and both test
 * files run the same cases.
 *
 * Pure Java on purpose: no RuneLite types, so it compiles and tests anywhere.
 */
public final class DropKey
{
	private DropKey()
	{
	}

	/** @return the key, or null when nothing is left to compare. */
	public static String of(String text)
	{
		if (text == null)
		{
			return null;
		}
		StringBuilder out = new StringBuilder(text.length());
		boolean gap = false;
		for (int i = 0; i < text.length(); i++)
		{
			char c = text.charAt(i);
			if (c >= 'A' && c <= 'Z')
			{
				c = (char) (c + 32);
			}
			// Apostrophes of every kind vanish: people leave them out.
			if (c == '\'' || c == '\u2019' || c == '\u2018' || c == '`' || c == '\u00b4')
			{
				continue;
			}
			if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))
			{
				if (gap && out.length() > 0)
				{
					out.append(' ');
				}
				gap = false;
				out.append(c);
			}
			else
			{
				gap = true;
			}
		}
		return out.length() == 0 ? null : out.toString();
	}
}
