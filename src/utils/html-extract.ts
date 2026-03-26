import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Parse5ParentNode = DefaultTreeAdapterMap['documentFragment'] | DefaultTreeAdapterMap['element'];
type Parse5ChildNode = Parse5ParentNode['childNodes'][number];

function isElementNode(node: Parse5ChildNode): node is DefaultTreeAdapterMap['element'] {
	return 'tagName' in node;
}

function getClassList(node: DefaultTreeAdapterMap['element']): string[] {
	const classAttribute = node.attrs.find((attribute) => attribute.name === 'class');
	return classAttribute ? classAttribute.value.split(/\s+/).filter(Boolean) : [];
}

function findFirstElementByClass(
	root: Parse5ParentNode,
	className: string
): DefaultTreeAdapterMap['element'] | null {
	for (const childNode of root.childNodes) {
		if (!isElementNode(childNode)) {
			continue;
		}

		if (getClassList(childNode).includes(className)) {
			return childNode;
		}

		const nestedMatch = findFirstElementByClass(childNode, className);
		if (nestedMatch) {
			return nestedMatch;
		}
	}

	return null;
}

function findFirstElementByTagName(
	root: Parse5ParentNode,
	tagName: string
): DefaultTreeAdapterMap['element'] | null {
	for (const childNode of root.childNodes) {
		if (!isElementNode(childNode)) {
			continue;
		}

		if (childNode.tagName === tagName) {
			return childNode;
		}

		const nestedMatch = findFirstElementByTagName(childNode, tagName);
		if (nestedMatch) {
			return nestedMatch;
		}
	}

	return null;
}

function getNodeTextContent(root: Parse5ParentNode): string {
	const textParts: string[] = [];

	for (const childNode of root.childNodes) {
		if ('value' in childNode) {
			textParts.push(childNode.value);
			continue;
		}

		if (isElementNode(childNode)) {
			textParts.push(getNodeTextContent(childNode));
		}
	}

	return textParts.join(' ').replace(/\s+/g, ' ').trim();
}

export function extractCalendarText(eventPageHtml: string): string {
	const document = parseFragment(eventPageHtml);
	const calendarElement = findFirstElementByClass(document, 'tito-event-homepage--basic-info-cal');
	if (!calendarElement) {
		throw new Error('Could not find event calendar info block');
	}

	return getNodeTextContent(calendarElement);
}

export function extractVenueInfo(eventPageHtml: string): {
	location: string;
	locationMapUrl: string | null;
} {
	const document = parseFragment(eventPageHtml);
	const venueElement = findFirstElementByClass(document, 'tito-venues');
	if (!venueElement) {
		throw new Error('Could not find event venue block');
	}

	const anchorElement = findFirstElementByTagName(venueElement, 'a');

	return {
		location: getNodeTextContent(venueElement),
		locationMapUrl: anchorElement?.attrs.find((attribute) => attribute.name === 'href')?.value ?? null,
	};
}