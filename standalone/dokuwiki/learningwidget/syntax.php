<?php
/**
 * DokuWiki Plugin learningwidget — Syntax Component (SPIKE)
 *
 *   <learning-widget src="kara" id="level-1" group="week-1">
 *   …body: Kara level text, or quiz HTML (<question-prompt>, <answer …>)…
 *   </learning-widget>
 *
 * `src` without a scheme or leading slash is a widget name under the
 * configured base_url ("kara" → <base_url>/kara/). Other attributes are passed
 * on (see embed.js for the reserved ones). Only name="value" attributes are
 * recognised; values are HTML-escaped on output.
 *
 * The body is emitted inside <script type="text/plain">, so nothing an author
 * writes there is parsed or run on the wiki page: embed.js reads it as text and
 * hands it to the widget, which runs in a sandboxed iframe. To keep the text
 * from ending that script element, "</script" and "<!--" are written as
 * "<\/script" and "<\!--" — the widget receives them in that form.
 * DokuWiki markup inside the body is not processed.
 *
 * @license MIT
 * @author  Tom Hofmann <tom@scheidweg.net>
 */

if (!defined('DOKU_INC')) die();

class syntax_plugin_learningwidget extends DokuWiki_Syntax_Plugin {

    const PATTERN = '<learning-widget\b[^>]*>[\s\S]*?</learning-widget>';

    public function getType() { return 'substition'; }
    public function getPType() { return 'block'; }
    public function getSort() { return 194; }

    public function connectTo($mode) {
        $this->Lexer->addSpecialPattern(self::PATTERN, $mode, 'plugin_learningwidget');
    }

    public function handle($match, $state, $pos, Doku_Handler $handler) {
        $open = strpos($match, '>');
        $tag = substr($match, 0, $open);
        $body = substr($match, $open + 1, -strlen('</learning-widget>'));

        $attrs = [];
        preg_match_all('/([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/', $tag, $m, PREG_SET_ORDER);
        foreach ($m as $a) $attrs[strtolower($a[1])] = $a[2];

        return ['attrs' => $attrs, 'body' => $body];
    }

    public function render($mode, Doku_Renderer $renderer, $data) {
        if ($mode !== 'xhtml') return false;
        $attrs = $data['attrs'];
        $attrs['src'] = $this->resolveSrc($attrs['src'] ?? '');

        $html = '<learning-widget';
        foreach ($attrs as $name => $value) $html .= ' ' . $name . '="' . hsc($value) . '"';
        $body = str_replace(['</script', '<!--'], ['<\/script', '<\!--'], $data['body']);
        $html .= '><script type="text/plain">' . $body . '</script></learning-widget>';

        $renderer->doc .= $html;
        return true;
    }

    /** "kara" → <base_url>/kara/; absolute URLs and paths are kept. */
    private function resolveSrc($src) {
        if ($src === '' || preg_match('#^([a-z][a-z0-9+.-]*:|/|\.)#i', $src)) return $src;
        return rtrim($this->getConf('base_url'), '/') . '/' . trim($src, '/') . '/';
    }
}
