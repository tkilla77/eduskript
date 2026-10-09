<?php
/**
 * DokuWiki Plugin learningwidget — Action Component (SPIKE)
 *
 * Adds the vendored host script (embed.js, a pinned copy shipped with this
 * plugin — it runs with the wiki's rights, so it is not loaded from the widget
 * server) and a rule hiding <learning-widget> bodies until it has run.
 *
 * @license MIT
 * @author  Tom Hofmann <tom@scheidweg.net>
 */

if (!defined('DOKU_INC')) die();

class action_plugin_learningwidget extends DokuWiki_Action_Plugin {

    public function register(Doku_Event_Handler $controller) {
        $controller->register_hook('TPL_METAHEADER_OUTPUT', 'BEFORE', $this, 'addHead');
    }

    public function addHead(Doku_Event $event) {
        $file = __DIR__ . '/embed.js';
        $event->data['script'][] = [
            'type'  => 'module',
            'src'   => DOKU_BASE . 'lib/plugins/learningwidget/embed.js?v=' . @filemtime($file),
            '_data' => '',
        ];
        $event->data['style'][] = [
            'type'  => 'text/css',
            '_data' => 'learning-widget{display:block;margin:1em 0 1.5em;border:1px solid #ddd;border-radius:6px;overflow:hidden}'
                     . 'learning-widget:not(:defined){display:none}',
        ];
    }
}
