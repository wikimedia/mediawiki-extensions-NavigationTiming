<?php
/**
 * Navigation Timing extension
 *
 * @file
 * @ingroup Extensions
 *
 * @author Asher Feldman <afeldman@wikimedia.org>
 * @author Ori Livneh <ori@wikimedia.org>
 * @author Patrick Reilly <preilly@php.net>
 *
 * @license GPL v2 or later
 * @version 1.0
 */

if ( function_exists( 'wfLoadExtension' ) ) {
	wfLoadExtension( 'NavigationTiming' );
	// Keep i18n globals so mergeMessageFileList.php doesn't break
	$wgMessagesDirs['NavigationTiming'] = __DIR__ . '/i18n';
	/*wfWarn(
		'Deprecated PHP entry point used for NavigationTiming extension. ' .
		'Please use wfLoadExtension instead, see ' .
		'https://www.mediawiki.org/wiki/Extension_registration for more details.'
	);*/
	return;
} else {
	die( 'This version of the NavigationTiming extension requires MediaWiki 1.25+' );
}
