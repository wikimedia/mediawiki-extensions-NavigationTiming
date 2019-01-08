/* eslint-env node */
module.exports = function ( grunt ) {
	grunt.loadNpmTasks( 'grunt-banana-checker' );

	grunt.initConfig( {
		banana: {
			all: 'i18n/'
		}
	} );

	grunt.registerTask( 'test', [ 'banana' ] );
};
