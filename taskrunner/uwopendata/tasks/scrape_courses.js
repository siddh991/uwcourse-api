const approot = require('app-root-path');
const logger = require(`${approot}/config/winston`)('scape_courses task');
const fs = require('fs');
const Course = require(`${approot}/models/Course`);
const uwapi = require('../config/uwopendata_api');
const coursediff = require('../utils/course_diff');
const timeOut = require(`${approot}/utils/delay`);

/**
 * Update our course details with new changes from UW OpenData API
 * These details do not include class schedules
 *
 * First, request a list of all available courses.
 * Then, send one request for details of each course.
 *
 * Compare result with the saved collection from the previous execution of the task.
 * If the collection does not exist, update every courses.
 * If the collection exists, update only the difference.
 * New courses are created.
 *
 * At the end, save courses as two local json files:
 *  - courses.json: a dictionary of all courses organized by course_id (includes
 *      all fields requested)
 *  - courses_array.json: an array of all courses (only includes course_id, subject,
 *      title and catalog_number)
 *
 * @param options
 * @returns {Promise<void>}
 */
module.exports = async (options) => {
    logger.info(`Starting scrape_courses`);

    options = Object.assign({
        // a dictionary of courses by course_id
        dictCoursesArchivePath: `${approot}/uwopendata/data/courses.json`,
        // an array of all courses
        listCoursesArchivePath: `${approot}/uwopendata/data/courses_array.json`,
        archiveEncoding: 'utf8',
        batchSize: 300,
        batchDelay: 500,
        firstRun: false
    }, options);

    let listCourses; // an array of all courses in the format given by /courses
    let dictCourses = {}; // dictionary of courses by course_id
    let dictCoursesArchiveExists = true; // check if the dictCoursesArchivePath file exist

    {
        // request for a list of all courses
        // remove the message field of the response
        logger.verbose(`Requesting a list of all courses`);
        listCourses = (await uwapi.get('/courses', {})).data;

        // Take only 50 for testing
        listCourses = listCourses.slice(0, 50);

        // create a dict of courses from listCourses
        for (let item of listCourses) {
            // Some courses a crosslisted and thus have the same course_id
            // Each item of dictCourses is thus a list to store multiple items
            if (dictCourses.hasOwnProperty(item.course_id))
                dictCourses[item.course_id].push(item);
            else
                dictCourses[item.course_id] = [item];
        }

        {
            logger.verbose(`Requesting details of ${listCourses.length} courses, one by one`);

            // Create a queue of parameters for GET requests
            let queueParameters = [];
            for (const item of listCourses) {
                queueParameters.push({endpoint: `/courses/${item.subject}/${item.catalog_number}`, qs: {}});
            }

            // listDetailedCourses contain an array of all responses, each corresponds to a course, from the UW API
            let listDetailedCourses = [];

            // Since there might be too many courses, we need to put a delay between our requests
            // TODO: Refactor this for reuse in other modules
            const requestInBatch = async () => {
                while (queueParameters.length > 0) {
                    let batchResult = await Promise.all(queueParameters.slice(0, options.batchSize)
                        .map(e => uwapi.get(e.endpoint, e.qs)));
                    queueParameters = queueParameters.slice(options.batchSize);
                    await timeOut(options.batchDelay);
                    for (let e of batchResult)
                        listDetailedCourses.push(e.data);
                }
            };
            try {
                await requestInBatch();
                logger.verbose(`Fetched details of ${listDetailedCourses.length}/${listCourses.length} courses`);
            } catch (error) {
                logger.error(`Failed to fetch details of ${listCourses.length} courses`);
                return;
            }

            // merge the `/courses` response with the `/courses/course_id` responses
            // since the response from `/courses` contain a subset of the fields we need, we will reuse it
            listDetailedCourses.forEach((detailedCourse) => {
                let listCoursesByID = dictCourses[detailedCourse.course_id];
                listCoursesByID.forEach((res_course, index) => {
                    if (res_course.subject === detailedCourse.subject &&
                        res_course.catalog_number === detailedCourse.catalog_number) {
                        listCoursesByID[index] = Object.assign({
                            units: detailedCourse.units,
                            description: detailedCourse.description,
                            instructions: detailedCourse.instructions,
                            prerequisites: detailedCourse.prerequisites,
                            corequisites: detailedCourse.corequisites,
                            antirequisites: detailedCourse.antirequisites,
                            crosslistings: detailedCourse.crosslistings,
                            notes: detailedCourse.notes,
                            offerings: detailedCourse.offerings,
                            needs_department_consent: detailedCourse.needs_department_consent,
                            needs_instructor_consent: detailedCourse.needs_instructor_consent,
                            extra: detailedCourse.extra,
                            url: detailedCourse.url,
                            academic_level: detailedCourse.academic_level,
                        }, res_course);
                    }
                });
            });
        }
    }

    if (!options.firstRun) {
        // Check if DOC_PATH exists
        try {
            await fs.promises.access(options.dictCoursesArchivePath, fs.constants.F_OK);
        } catch (err) {
            if (err.code === 'ENOENT')
                dictCoursesArchiveExists = false;
            else throw Error(err);
        }
        logger.verbose(`${options.dictCoursesArchivePath} ${dictCoursesArchiveExists ? 'exist' : 'does not exist'}`);
    }

    let items;
    if (!dictCoursesArchiveExists || options.firstRun) {
        logger.verbose('Updating the whole database');
        items = coursediff.newCourses([], dictCourses);
    } else {
        logger.verbose('Loading previous state documents and compare');
        let archivedState = JSON.parse(await fs.promises.readFile(options.dictCoursesArchivePath, options.archiveEncoding));
        items = coursediff.newCourses(archivedState, dictCourses);
        items = items + coursediff.generateModifications(archivedState, dictCourses);
    }

    try {
        const upsertResult = await Course.bulkUpsertUpdateOne(items);
        logger.verbose(`Successfully updated ${upsertResult.nUpserted} and created ${upsertResult.nModified} ` +
            `courses on database`);
    } catch (err) {
        logger.error(`Failed to update Course model`);
        logger.error(err);
        throw Error(err);
    }

    try {
        logger.verbose(`Saving course details as dictionary to ${options.dictCoursesArchivePath}`);
        await fs.promises.writeFile(options.dictCoursesArchivePath, JSON.stringify(dictCourses), options.archiveEncoding);
        logger.verbose(`Updated ${options.dictCoursesArchivePath}`);
    } catch (err) {
        logger.error(err);
        throw Error(err);
    }

    try {
        logger.verbose(`Saving course array to ${options.listCoursesArchivePath}`);

        // Drop the course title since we are not using it
        for (let item in listCourses) {
            delete item.title;
        }

        await fs.promises.writeFile(options.listCoursesArchivePath, JSON.stringify(listCourses), options.archiveEncoding);
        logger.verbose(`Updated ${options.listCoursesArchivePath}`);
    }
    catch (err) {
        logger.error(err);
        throw Error(err);
    }

    logger.info(`scrape_courses succeeded`);
};
